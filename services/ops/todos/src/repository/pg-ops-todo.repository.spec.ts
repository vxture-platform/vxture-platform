/**
 * pg-ops-todo.repository.spec.ts — 假 pool 下钉住：参数绑定、按类别拼片段、谓词字面、
 * 行 → 待办映射、升档。
 *
 * 假 pool 不解析 SQL，所以谓词只能靠字面断言钉住（与 service-notice 同一手法）；
 * 真 SQL 的行为在 ops-todos.itest.spec.ts 打真库——包括「作业那一拼在
 * `set role svc_platform_api` 下跑得通」那一条，它才是最小权限那件事的真判据。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_OPS_TODO_THRESHOLDS,
  LIST_OPS_TODOS_SQL,
  OpsTodoRepository,
  TAIL_COMPUTED_COLUMNS,
  TODO_COLUMN_ORDER,
  bindListOptions,
  buildListOpsTodosSql,
  mapOpsTodoRow,
  opsTodoThresholds,
  unionCteTexts,
  type OpsTodoRow,
} from "./pg-ops-todo.repository";
import { OPS_TODO_KINDS, type OpsTodoKind } from "../types";

const baseRow = (over: Partial<OpsTodoRow>): OpsTodoRow => ({
  kind: "confirm_payment",
  subject_type: "order",
  subject_no: "ORD-1",
  subject_key: null,
  order_no: "ORD-1",
  tenant_no: "200000010",
  tenant_name: "示例租户",
  tenant_type: "company",
  tenant_status: "active",
  tenant_region: "上海市浦东新区",
  tenant_industry: "manufacturing",
  tenant_scale: "50-200",
  tenant_risk_level: "follow_up",
  applicant_name: "申报人",
  applicant_email: "a@example.com",
  applicant_phone: "+8613800000000",
  amount_value: "99.00",
  amount_paid: null,
  amount_currency: "CNY",
  product_code: "karda",
  product_name: "Karda",
  plan_name: "专业版",
  severity: "rose",
  priority: 2,
  waiting_since: new Date("2026-09-28T01:49:00.000Z"),
  ticket_title: null,
  ticket_priority: null,
  ticket_status: null,
  severity_effective: "rose",
  escalated: false,
  escalation_step: 0,
  ...over,
});

/**
 * 作业读的那一拼：九类 + 不带富化块（逐字同 ops-todo-alert.job 的 ALERT_KINDS；
 * 那边与本文件的一致性由 check-ops-todo-alerts 对账）。
 */
const ALERT_KINDS: readonly OpsTodoKind[] = [
  "confirm_payment",
  "reprovision",
  "refund_audit",
  "refund_execute",
  "refund_processing_stuck",
  "refund_failed",
  "addon_pending_confirm",
  "ticket_sla",
  "maintenance_overdue",
];

const ALERT_SQL = buildListOpsTodosSql({
  kinds: ALERT_KINDS,
  includeApplicant: false,
});

/** 九个绑定参数里的后六个（阈值），按默认值展开——各用例只关心前三个。 */
const DEFAULT_THRESHOLD_PARAMS = [
  DEFAULT_OPS_TODO_THRESHOLDS.confirmPaymentHours,
  DEFAULT_OPS_TODO_THRESHOLDS.refundAuditHours,
  DEFAULT_OPS_TODO_THRESHOLDS.reprovisionMinutes,
  DEFAULT_OPS_TODO_THRESHOLDS.verificationDays,
  DEFAULT_OPS_TODO_THRESHOLDS.orderAgingHours,
  DEFAULT_OPS_TODO_THRESHOLDS.refundStuckHours,
];

describe("bindListOptions", () => {
  it("不传选项 = 全类别、不按停留过滤、默认上限、六个阈值取默认", () => {
    expect(bindListOptions()).toEqual([
      null,
      null,
      DEFAULT_LIST_LIMIT,
      ...DEFAULT_THRESHOLD_PARAMS,
    ]);
  });

  it("告警作业的三个参数原样绑定，阈值补在后面", () => {
    expect(
      bindListOptions({
        kinds: ["confirm_payment", "reprovision", "refund_audit"],
        minAgeMinutes: 15,
        limit: 50,
      }),
    ).toEqual([
      ["confirm_payment", "reprovision", "refund_audit"],
      15,
      50,
      ...DEFAULT_THRESHOLD_PARAMS,
    ]);
  });

  it("未知类别 / 非整数 minAge / 越界 limit 在进 SQL 之前就抛", () => {
    expect(() => bindListOptions({ kinds: ["nope" as never] })).toThrow(
      /未知待办类别/,
    );
    expect(() => bindListOptions({ minAgeMinutes: 1.5 })).toThrow(
      /minAgeMinutes/,
    );
    expect(() => bindListOptions({ limit: 0 })).toThrow(/limit/);
    expect(() => bindListOptions({ limit: 999_999 })).toThrow(/limit/);
  });

  it("阈值必须是正整数：0 / 负数 / 小数在这里抛，不进 SQL", () => {
    // 0 进了 SQL 会被 nullif 兜成「不升档」，但那是安全带不是行为约定——
    // 调用方给 0 是配错了，应该当场知道。
    expect(() =>
      bindListOptions({ thresholds: { confirmPaymentHours: 0 } }),
    ).toThrow(/confirmPaymentHours/);
    expect(() =>
      bindListOptions({ thresholds: { reprovisionMinutes: -1 } }),
    ).toThrow(/reprovisionMinutes/);
    expect(() =>
      bindListOptions({ thresholds: { verificationDays: 1.5 } }),
    ).toThrow(/verificationDays/);
  });

  it("阈值覆盖只动被传的那几个，其余仍走默认", () => {
    const params = bindListOptions({
      thresholds: { confirmPaymentHours: 1, refundStuckHours: 2 },
    });
    expect(params[3]).toBe(1);
    expect(params[4]).toBe(DEFAULT_OPS_TODO_THRESHOLDS.refundAuditHours);
    expect(params[8]).toBe(2);
  });
});

describe("opsTodoThresholds：env 为准，读不到就兜底", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("六个 env 都认", () => {
    process.env.OPS_ESCALATE_CONFIRM_PAYMENT_HOURS = "2";
    process.env.OPS_ESCALATE_REFUND_AUDIT_HOURS = "12";
    process.env.OPS_ESCALATE_REPROVISION_MINUTES = "10";
    process.env.OPS_ESCALATE_VERIFICATION_DAYS = "1";
    process.env.OPS_ORDER_AGING_HOURS = "6";
    process.env.OPS_REFUND_STUCK_HOURS = "3";
    expect(opsTodoThresholds()).toEqual({
      confirmPaymentHours: 2,
      refundAuditHours: 12,
      reprovisionMinutes: 10,
      verificationDays: 1,
      orderAgingHours: 6,
      refundStuckHours: 3,
    });
  });

  it("空 / 非数 / 0 / 负数一律兜底——一个配歪的阈值不该让整页打不开", () => {
    process.env.OPS_ESCALATE_CONFIRM_PAYMENT_HOURS = "";
    process.env.OPS_ESCALATE_REFUND_AUDIT_HOURS = "soon";
    process.env.OPS_ESCALATE_REPROVISION_MINUTES = "0";
    process.env.OPS_ESCALATE_VERIFICATION_DAYS = "-3";
    delete process.env.OPS_ORDER_AGING_HOURS;
    delete process.env.OPS_REFUND_STUCK_HOURS;
    expect(opsTodoThresholds()).toEqual(DEFAULT_OPS_TODO_THRESHOLDS);
  });
});

describe("buildListOpsTodosSql：请求哪几类就只拼哪几段", () => {
  it("全量（页面那一拼）：十段 CTE 齐全，底座在，富化块在", () => {
    expect(LIST_OPS_TODOS_SQL).toBe(buildListOpsTodosSql());
    for (const cte of [
      "order_todos as (",
      "refund_todos as (",
      "subscription_todos as (",
      "invoice_todos as (",
      "addon_todos as (",
      "user_todos as (",
      "maintenance_todos as (",
      "tenant_base as (",
      "verification_todos as (",
      "risk_todos as (",
      "ticket_todos as (",
    ]) {
      expect(LIST_OPS_TODOS_SQL).toContain(cte);
    }
    expect(LIST_OPS_TODOS_SQL).toContain("left join account.users ou");
    expect(LIST_OPS_TODOS_SQL).toContain("from admin.risk_records rr");
  });

  it("只要退款一类：订单 / 订阅 / 发票 / 加油包 / 账号 / 维护 / 租户 / 工单那几段一个都不拼进文本", () => {
    const sql = buildListOpsTodosSql({ kinds: ["refund_audit"] });
    expect(sql).toContain("refund_todos as (");
    expect(sql).toContain("  select * from refund_todos");
    for (const absent of [
      "order_todos as (",
      "subscription_todos as (",
      "invoice_todos as (",
      "addon_todos as (",
      "user_todos as (",
      "maintenance_todos as (",
      "tenant_base as (",
      "ticket_todos as (",
      "from billing.orders o\n",
      "support.tickets k",
      "kyc.tenant_verifications",
      "session.auth_sessions",
      "admin.maintenance_windows",
      "metering.addon_purchases",
      "billing.invoice_receipts",
    ]) {
      expect(sql).not.toContain(absent);
    }
  });

  it("同一段里的兄弟类别只拼一次：refund 四类 / ticket 两类 / order 四类", () => {
    const refunds = buildListOpsTodosSql({
      kinds: ["refund_audit", "refund_execute", "refund_failed"],
    });
    expect(refunds.match(/refund_todos as \(/g)).toHaveLength(1);
    expect(refunds.match(/select \* from refund_todos/g)).toHaveLength(1);

    const tickets = buildListOpsTodosSql({ kinds: ["ticket", "ticket_sla"] });
    expect(tickets.match(/ticket_todos as \(/g)).toHaveLength(1);
  });

  it("只要 ticket_sla：仍拼整段 ticket_todos（同一段产两类），外层按 $1 过滤", () => {
    const sql = buildListOpsTodosSql({ kinds: ["ticket_sla"] });
    expect(sql).toContain("ticket_todos as (");
    expect(sql).toContain("case when sla.breached then 'ticket_sla'");
    expect(sql).toContain("($1::text[] is null or y.kind = any($1::text[]))");
  });

  it("认证 / 风险两类要底座；只要认证时不拼 risk_todos", () => {
    const sql = buildListOpsTodosSql({ kinds: ["verification"] });
    expect(sql).toContain("tenant_base as (");
    expect(sql).toContain("verification_todos as (");
    expect(sql).not.toContain("risk_todos as (");
    expect(sql).toContain("  select * from verification_todos");
  });

  it("空类别集拼不出 SQL，直接抛（调用方该在此之前回空列表）", () => {
    expect(() => buildListOpsTodosSql({ kinds: [] })).toThrow(
      /没有任何类别入选/,
    );
  });

  it("union 只用 select \\* + union all，第一段不带 union all", () => {
    const sql = buildListOpsTodosSql({
      kinds: ["confirm_payment", "refund_audit"],
    });
    const body = sql.slice(sql.indexOf(", todos as ("));
    expect(body).toContain("  select * from order_todos");
    expect(body).toContain("  union all select * from refund_todos");
    expect(body).not.toContain("union all select * from order_todos");
  });

  it("每一拼都引用到 $1..$9：参数个数由文本决定，少一个 $n 就是 bind 报错", () => {
    for (const kinds of [
      undefined,
      ["refund_audit"] as const,
      ["verification"] as const,
      ["maintenance_overdue"] as const,
      ["deletion_pending"] as const,
      ALERT_KINDS,
    ]) {
      const sql = kinds
        ? buildListOpsTodosSql({ kinds: [...kinds] })
        : buildListOpsTodosSql();
      for (let n = 1; n <= 9; n += 1) {
        expect(
          sql,
          `kinds=${kinds ? kinds.join(",") : "全部"} 少了 $${n}`,
        ).toContain(`$${n}`);
      }
      // 没有第十个参数：多一个 $n 同样是 bind 报错。
      expect(sql).not.toContain("$10");
    }
  });
});

describe("作业那一拼（includeApplicant: false）只碰 svc_platform_api 有权的关系", () => {
  /**
   * 97_service_roles.sql 给 svc_platform_api 的 7 个 schema 之外、且**没有**表级例外的那些。
   * 真判据在 itest（set role 之后真跑）；这里只钉住「文本里出现过没有」——
   * Postgres 查权限看的正是文本里出现过的关系，不管那一支返不返回行。
   *
   * 2026-09-28 第三批起，作业那一拼**合法地**碰两张表级例外（97 末尾逐条 GRANT SELECT）：
   * `support.tickets`（ticket_sla）与 `admin.maintenance_windows`（maintenance_overdue）。
   * 所以这张名单按**关系**列而不是按 schema 前缀列——按前缀列会把那两张也判成越界。
   */
  const forbidden = [
    "account.users",
    "account.user_profiles",
    "admin.risk_records",
    "admin.operator_account",
    "kyc.tenant_verifications",
    "session.auth_sessions",
    "support.audit_logs",
    "support.inbox_messages",
    "support.ticket_comments",
    "identity.",
    "credential.",
    "access.",
    "loyalty.",
    "appoidc.",
    "safety.",
    "tenancy.tenant_contacts",
  ];

  it("一个越界关系都不出现", () => {
    for (const needle of forbidden) {
      expect(ALERT_SQL, needle).not.toContain(needle);
    }
  });

  it("该在的还在：五段 + 两张表级例外 + 九个绑定参数", () => {
    expect(ALERT_SQL).toContain("from billing.orders o");
    expect(ALERT_SQL).toContain("from billing.refunds r");
    expect(ALERT_SQL).toContain("from metering.addon_purchases ap");
    expect(ALERT_SQL).toContain("from support.tickets k");
    expect(ALERT_SQL).toContain("from admin.maintenance_windows mw");
    expect(ALERT_SQL).toContain("join tenancy.tenants t");
    expect(ALERT_SQL).toContain("left join tenancy.tenant_profiles tp");
    expect(ALERT_SQL).toMatch(/limit \$3::int\s*$/);
  });

  it("不告警的那几段一段都不拼：订阅 / 发票 / 账号注销 / 租户", () => {
    for (const absent of [
      "subscription_todos as (",
      "invoice_todos as (",
      "user_todos as (",
      "tenant_base as (",
      "metering.subscription_histories",
    ]) {
      expect(ALERT_SQL, absent).not.toContain(absent);
    }
  });

  it("富化的四列退成 null，列名一个不少（union 要对齐）", () => {
    expect(ALERT_SQL).toContain("null::text as tenant_risk_level");
    expect(ALERT_SQL).toContain("null::text as applicant_name");
    expect(ALERT_SQL).toContain("null::text as applicant_email");
    expect(ALERT_SQL).toContain("null::text as applicant_phone");
  });
});

describe("union 的投影列逐段对齐", () => {
  /** 一段 CTE 的投影列 = select 到 `from` 之前那一截里的 `as <别名>`，按出现顺序。 */
  const aliasesOf = (sql: string): string[] => {
    const head = sql.slice(0, sql.indexOf("\n  from "));
    return [...head.matchAll(/\bas (\w+)/g)].map((m) => m[1]!);
  };

  for (const includeApplicant of [true, false]) {
    it(`includeApplicant=${includeApplicant}：十段的列名与顺序都等于 TODO_COLUMN_ORDER`, () => {
      const ctes = unionCteTexts(includeApplicant);
      expect(ctes.map((c) => c.name)).toEqual([
        "order_todos",
        "refund_todos",
        "subscription_todos",
        "invoice_todos",
        "addon_todos",
        "user_todos",
        "maintenance_todos",
        "verification_todos",
        "risk_todos",
        "ticket_todos",
      ]);
      for (const cte of ctes) {
        expect(aliasesOf(cte.sql), cte.name).toEqual([...TODO_COLUMN_ORDER]);
      }
    });
  }

  it("OpsTodoRow 的字段 = 投影列 + 外层算出来的三列（多一列少一列在这里红）", () => {
    const row = baseRow({});
    expect(Object.keys(row).sort()).toEqual(
      [...TODO_COLUMN_ORDER, ...TAIL_COMPUTED_COLUMNS].sort(),
    );
  });
});

describe("LIST_OPS_TODOS_SQL 的谓词字面", () => {
  it("九个参数：前三个「为空即不过滤」，后六个是时长阈值", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "($1::text[] is null or y.kind = any($1::text[]))",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "($2::int is null or y.waiting_since + make_interval(mins => $2::int) <= now())",
    );
    expect(LIST_OPS_TODOS_SQL).toMatch(/limit \$3::int\s*$/);
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when 'confirm_payment' then $4::int * 3600",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when 'refund_audit'    then $5::int * 3600",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when 'reprovision'     then $6::int * 60",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when 'verification'    then $7::int * 86400",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when 'order_pending_payment_aging' then make_interval(hours => $8::int)",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when 'refund_processing_stuck'     then make_interval(hours => $9::int)",
    );
  });

  it("升档：级数封顶 12，阈值为 0 时退成不升档，严重度按升档后的算", () => {
    expect(LIST_OPS_TODOS_SQL).toContain("when thr.seconds is null then 0");
    expect(LIST_OPS_TODOS_SQL).toContain("), 0), 12)::int");
    expect(LIST_OPS_TODOS_SQL).toContain("nullif(case x.kind");
    expect(LIST_OPS_TODOS_SQL).toContain(
      "(y.escalation_step >= 1)                            as escalated",
    );
    // blue 升一档到 amber，其余（amber / rose）升到 rose——rose 已是顶档。
    expect(LIST_OPS_TODOS_SQL).toContain(
      "then case y.severity when 'blue' then 'amber' else 'rose' end",
    );
  });

  it("排序 = 升档后的严重度 → 优先级 → 等待起点升序", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "order by severity_rank, priority, waiting_since asc",
    );
    // severity_rank 也按升档后算，否则升了档却排在原位（等于没升）。
    expect(LIST_OPS_TODOS_SQL).toContain(
      "then case y.severity when 'blue' then 1 else 0 end",
    );
  });

  it("原始订单态 → 待办类的对应写成一段 case（守卫从这里解析）", () => {
    const block = LIST_OPS_TODOS_SQL.match(
      /case o\.status\n([\s\S]*?)end\s+as kind/,
    );
    expect(block).not.toBeNull();
    const pairs = [...block![1]!.matchAll(/when '(\w+)'\s+then '(\w+)'/g)].map(
      (m) => [m[1], m[2]],
    );
    // pending_payment 那一支现在分两类，所以它不再是「一个状态一个类」的直接对应。
    expect(pairs).toEqual([
      ["pending_verify", "confirm_payment"],
      ["paid", "reprovision"],
    ]);
    // 尾款挂账只在最近账单 partial 时成立——与 orders.router 的 partial_pending 同口径；
    // 否则（从没申报过的待付款单）落到「挂着没人付」那一类。
    expect(LIST_OPS_TODOS_SQL).toContain(
      "case when inv.bill_status = 'partial' then 'follow_up_balance'\n             else 'order_pending_payment_aging' end",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "or (o.status = 'pending_payment' and inv.bill_status = 'partial')",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "or (o.status = 'pending_payment' and o.declared_at is null)",
    );
    // 已收多少只有尾款挂账那一类带（其余类别 amount.paid = null）。
    expect(LIST_OPS_TODOS_SQL).toContain(
      "case when o.status = 'pending_payment' and inv.bill_status = 'partial'\n         then inv.paid_amount::text end                    as amount_paid",
    );
  });

  it("退款四类：两根状态机叉乘只落四格，等待起点各归各", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where (r.refund_status = 'pending' and r.audit_status in ('pending', 'approved'))\n     or r.refund_status in ('processing', 'failed')",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when r.refund_status = 'failed'     then 'refund_failed'",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when r.refund_status = 'processing' then 'refund_processing_stuck'",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when r.audit_status  = 'approved'   then 'refund_execute'",
    );
    // 审过没退 → 从审核时刻算（退回 updated_at）；待审 → 从申请时刻算。
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when r.refund_status = 'pending' and r.audit_status = 'approved'\n        then coalesce(r.audit_at, r.updated_at)",
    );
  });

  it("其余新类别的谓词字面：订阅 / 发票 / 加油包 / 注销 / 维护 / 工单 SLA", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where s.status = 'overdue' and s.deleted_at is null",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where sh.subscription_id = s.id and sh.to_status = 'overdue'",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where ir.invoice_status in ('applying', 'approved') and ir.deleted_at is null",
    );
    expect(LIST_OPS_TODOS_SQL).toContain("where ap.status = 'pending_payment'");
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where u.status = 'deleting' and u.deleted_at is null",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "u.deletion_requested_at + interval '27 days' <= now()",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where mw.status = 'in_progress' and mw.end_at < now()",
    );
    expect(LIST_OPS_TODOS_SQL).toContain("and k.first_response_at is null");
    for (const sla of [
      "when 'p0' then interval '1 hour'",
      "when 'p1' then interval '4 hours'",
      "when 'p2' then interval '24 hours'",
      "else interval '72 hours'",
    ]) {
      expect(LIST_OPS_TODOS_SQL).toContain(sla);
    }
  });

  it("工单：未结四态照旧；SLA 破了才另算一类，等待起点从建单算", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "and k.status not in ('resolved', 'closed', 'cancelled')",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "case when sla.breached then k.created_at else k.updated_at end as waiting_since",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when k.priority = 'p0' or k.status = 'reopened' then 'rose'",
    );
    // 库里没有这些工单状态（72_support.sql 的 chk_tickets_status），判它们只是自欺。
    // 只在工单那一段里判：`'processing'` 在退款那一段是**真值域**
    // （billing.refunds.refund_status），整篇搜等于把两个值域混成一个。
    const ticketCte = unionCteTexts(true).find(
      (c) => c.name === "ticket_todos",
    )!;
    for (const dead of ["'blocked'", "'waiting'", "'new'", "'processing'"]) {
      expect(ticketCte.sql, dead).not.toContain(dead);
    }
    // 状态原样下发，不在 SQL 里归一——页面要显示「重开」就得看得见 reopened。
    expect(LIST_OPS_TODOS_SQL).toContain("k.status                       ");
  });

  it("租户：认证 pending / 风险 / 停用", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where verification_status = 'pending'",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where coalesce(risk_level, 'normal') <> 'normal' or status = 'suspended'",
    );
  });

  /**
   * 上屏的列里没有 uuid 主键。**唯一的例外是 `subject_key`**——它是身份不是称呼，
   * 只进 OpsTodo.id（React key 与告警去重键），href / 主体码 / 标题 / 正文都不取它。
   * 所以这条断言按「哪一列」判，不按「有没有出现 .id」判：
   *   · 任何 `<别名>.id` 只许落在 `as subject_key` 上；
   *   · 维护窗口那一段必须真的给出身份（漏了就退回不唯一的标题，同名窗口撞成一条）。
   */
  it("投影列里的 uuid 主键只许落在 subject_key 上", () => {
    const union = LIST_OPS_TODOS_SQL.slice(
      LIST_OPS_TODOS_SQL.indexOf(", todos as ("),
    );
    expect(union).not.toMatch(/\bx\.id\b/);
    for (const alias of ["o", "r", "k", "s", "ir", "ap", "u", "mw"]) {
      for (const [, column] of LIST_OPS_TODOS_SQL.matchAll(
        new RegExp(`\\b${alias}\\.id(?:::\\w+)?\\s+as\\s+(\\w+)`, "g"),
      )) {
        expect(column, `${alias}.id 只许作为 subject_key 投影`).toBe(
          "subject_key",
        );
      }
    }
    // 维护窗口：称呼仍是标题，身份是窗口主键（title 上没有唯一约束）。
    expect(LIST_OPS_TODOS_SQL).toContain("mw.title                        ");
    expect(LIST_OPS_TODOS_SQL).toMatch(/mw\.id::text\s+as subject_key,/);
    // 其余每一段都把这一列留空——身份就退回它自己的可视码。
    expect([...LIST_OPS_TODOS_SQL.matchAll(/as subject_key,/g)]).toHaveLength(
      10,
    );
  });
});

describe("mapOpsTodoRow", () => {
  it("订单待办：id 稳定、href 走 order_no、金额是应收、租户属性齐全", () => {
    const todo = mapOpsTodoRow(baseRow({}));
    expect(todo).toMatchObject({
      id: "confirm_payment:ORD-1",
      kind: "confirm_payment",
      severity: "rose",
      priority: 2,
      subject: { type: "order", no: "ORD-1" },
      tenant: {
        no: "200000010",
        name: "示例租户",
        type: "company",
        status: "active",
        riskLevel: "follow_up",
        region: "上海市浦东新区",
        industry: "manufacturing",
        scale: "50-200",
      },
      applicant: {
        name: "申报人",
        email: "a@example.com",
        phone: "+8613800000000",
      },
      amount: { value: "99.00", currency: "CNY", paid: null },
      product: { code: "karda", name: "Karda", planName: "专业版" },
      progress: "pendingVerify",
      waitingSince: "2026-09-28T01:49:00.000Z",
      href: "/orders/ORD-1",
      escalated: false,
      escalationStep: 0,
    });
    expect(todo.ticket).toBeUndefined();
  });

  it("严重度取的是升档后那一列，不是片段给的基准档", () => {
    const todo = mapOpsTodoRow(
      baseRow({
        kind: "verification",
        subject_type: "tenant",
        subject_no: "200000010",
        severity: "amber",
        severity_effective: "rose",
        escalated: true,
        escalation_step: 2,
      }),
    );
    expect(todo.severity).toBe("rose");
    expect(todo.escalated).toBe(true);
    expect(todo.escalationStep).toBe(2);
  });

  it("升档级数从 pg 回来可能是字符串，转成数字", () => {
    expect(
      mapOpsTodoRow(baseRow({ escalated: true, escalation_step: "3" }))
        .escalationStep,
    ).toBe(3);
  });

  it("租户属性读不到就是 null，不兜默认档", () => {
    const todo = mapOpsTodoRow(
      baseRow({
        tenant_status: null,
        tenant_risk_level: null,
        tenant_region: null,
        tenant_industry: null,
        tenant_scale: null,
      }),
    );
    expect(todo.tenant).toEqual({
      no: "200000010",
      name: "示例租户",
      type: "company",
      status: null,
      riskLevel: null,
      region: null,
      industry: null,
      scale: null,
    });
  });

  it("作业那一拼回来的行：申报人整块为 null、风险档为 null，其余照常", () => {
    const todo = mapOpsTodoRow(
      baseRow({
        applicant_name: null,
        applicant_email: null,
        applicant_phone: null,
        tenant_risk_level: null,
      }),
    );
    expect(todo.applicant).toBeNull();
    expect(todo.tenant?.riskLevel).toBeNull();
    expect(todo.tenant?.name).toBe("示例租户");
    expect(todo.amount).toEqual({
      value: "99.00",
      currency: "CNY",
      paid: null,
    });
  });

  it("尾款挂账：amount.paid = 已收多少", () => {
    expect(
      mapOpsTodoRow(
        baseRow({
          kind: "follow_up_balance",
          severity: "amber",
          severity_effective: "amber",
          priority: 15,
          amount_value: "99.00",
          amount_paid: "30.00",
        }),
      ),
    ).toMatchObject({
      progress: "partialPending",
      severity: "amber",
      amount: { value: "99.00", currency: "CNY", paid: "30.00" },
    });
  });

  it("已收款未开通那一类的进度键", () => {
    expect(
      mapOpsTodoRow(baseRow({ kind: "reprovision", priority: "3" })),
    ).toMatchObject({ progress: "paidUnprovisioned", priority: 3 });
  });

  it("挂着没人付的单：进度 orderAging，一般档，href 仍是订单详情", () => {
    expect(
      mapOpsTodoRow(
        baseRow({
          kind: "order_pending_payment_aging",
          severity: "blue",
          severity_effective: "blue",
          priority: 40,
          amount_paid: null,
        }),
      ),
    ).toMatchObject({
      id: "order_pending_payment_aging:ORD-1",
      progress: "orderAging",
      severity: "blue",
      href: "/orders/ORD-1",
    });
  });

  it("退款四类：主体都是退款单号，href 落到订单详情，找不到订单退回列表", () => {
    const row = baseRow({
      kind: "refund_audit",
      subject_type: "refund",
      subject_no: "RFD-202609-4E7BD7BEC1",
      order_no: "ORD-9",
      amount_value: "99.00",
    });
    expect(mapOpsTodoRow(row)).toMatchObject({
      id: "refund_audit:RFD-202609-4E7BD7BEC1",
      subject: { type: "refund", no: "RFD-202609-4E7BD7BEC1" },
      progress: "refundAudit",
      href: "/orders/ORD-9",
      amount: { value: "99.00", currency: "CNY", paid: null },
    });
    expect(mapOpsTodoRow({ ...row, order_no: null }).href).toBe("/orders");
    for (const [kind, progress] of [
      ["refund_execute", "refundExecute"],
      ["refund_processing_stuck", "refundProcessing"],
      ["refund_failed", "refundFailed"],
    ] as const) {
      expect(mapOpsTodoRow({ ...row, kind }), kind).toMatchObject({
        progress,
        href: "/orders/ORD-9",
        subject: { type: "refund", no: "RFD-202609-4E7BD7BEC1" },
      });
    }
  });

  it("订阅欠费：主体是当前订单号，href 是订阅详情；没有订单时退回订阅列表", () => {
    const row = baseRow({
      kind: "subscription_overdue",
      subject_type: "subscription",
      subject_no: "ORD-7",
      order_no: "ORD-7",
      severity: "amber",
      severity_effective: "amber",
      priority: 12,
      amount_value: null,
      amount_currency: null,
    });
    expect(mapOpsTodoRow(row)).toMatchObject({
      id: "subscription_overdue:ORD-7",
      subject: { type: "subscription", no: "ORD-7" },
      progress: "subscriptionOverdue",
      href: "/subscriptions/ORD-7",
      // 欠的是续费单上的钱，不是本行的快照——不给一个像是的数。
      amount: null,
    });
    expect(
      mapOpsTodoRow({ ...row, subject_no: "3000000017", order_no: null }).href,
    ).toBe("/subscriptions");
  });

  it("发票两档：主体是发票申请号，都去 /invoices", () => {
    const row = baseRow({
      kind: "invoice_applying",
      subject_type: "invoice",
      subject_no: "INV-202609-01",
      order_no: null,
      severity: "amber",
      severity_effective: "amber",
      priority: 18,
      product_code: null,
      product_name: null,
      plan_name: null,
    });
    expect(mapOpsTodoRow(row)).toMatchObject({
      id: "invoice_applying:INV-202609-01",
      progress: "invoiceApplying",
      href: "/invoices",
      product: null,
      amount: { value: "99.00", currency: "CNY", paid: null },
    });
    expect(
      mapOpsTodoRow({ ...row, kind: "invoice_approved", priority: 19 }),
    ).toMatchObject({ progress: "invoiceApproved", href: "/invoices" });
  });

  it("加油包待核销：主体是加油包单号，去 /addon-orders，产品位放包名", () => {
    expect(
      mapOpsTodoRow(
        baseRow({
          kind: "addon_pending_confirm",
          subject_type: "addon",
          subject_no: "ORD-202609-ADDON1",
          order_no: null,
          priority: 7,
          product_code: "pack-tokens-1m",
          product_name: "Token 加油包 100 万",
          plan_name: null,
        }),
      ),
    ).toMatchObject({
      id: "addon_pending_confirm:ORD-202609-ADDON1",
      progress: "addonPendingConfirm",
      severity: "rose",
      href: "/addon-orders",
      product: {
        code: "pack-tokens-1m",
        name: "Token 加油包 100 万",
        planName: null,
      },
    });
  });

  it("注销两档：主体是用户号，去账号详情，没有租户块", () => {
    const row = baseRow({
      kind: "deletion_pending",
      subject_type: "user",
      subject_no: "1000000018",
      order_no: null,
      tenant_no: null,
      tenant_name: null,
      tenant_type: null,
      tenant_status: null,
      tenant_region: null,
      tenant_industry: null,
      tenant_scale: null,
      tenant_risk_level: null,
      amount_value: null,
      amount_paid: null,
      amount_currency: null,
      product_code: null,
      product_name: null,
      plan_name: null,
      severity: "blue",
      severity_effective: "blue",
      priority: 45,
    });
    expect(mapOpsTodoRow(row)).toMatchObject({
      id: "deletion_pending:1000000018",
      subject: { type: "user", no: "1000000018" },
      tenant: null,
      progress: "deletionPending",
      severity: "blue",
      href: "/accounts/1000000018",
      // 「谁在等」还在：注销申请人自己。
      applicant: { name: "申报人" },
    });
    expect(
      mapOpsTodoRow({
        ...row,
        kind: "purge_imminent",
        severity: "amber",
        severity_effective: "amber",
        priority: 16,
      }),
    ).toMatchObject({
      progress: "purgeImminent",
      severity: "amber",
      href: "/accounts/1000000018",
    });
  });

  it("维护窗口超时：主体是窗口标题，**没有链接**（admin 里没这一页）", () => {
    expect(
      mapOpsTodoRow(
        baseRow({
          kind: "maintenance_overdue",
          subject_type: "maintenance",
          subject_no: "数据库主从切换",
          subject_key: "aaaaaaaa-1111-4111-8111-111111111111",
          order_no: null,
          tenant_no: null,
          tenant_name: null,
          tenant_type: null,
          tenant_status: null,
          tenant_region: null,
          tenant_industry: null,
          tenant_scale: null,
          tenant_risk_level: null,
          applicant_name: null,
          applicant_email: null,
          applicant_phone: null,
          amount_value: null,
          amount_paid: null,
          amount_currency: null,
          product_code: null,
          product_name: null,
          plan_name: null,
          priority: 9,
        }),
      ),
    ).toMatchObject({
      // 身份取窗口主键（标题不唯一）；这个值只当键用。
      id: "maintenance_overdue:aaaaaaaa-1111-4111-8111-111111111111",
      subject: { type: "maintenance", no: "数据库主从切换" },
      tenant: null,
      applicant: null,
      amount: null,
      product: null,
      progress: "maintenanceOverdue",
      severity: "rose",
      href: null,
    });
  });

  /**
   * 「两个同名窗口同时超时」是运营的常态（`例行维护` 这种名字会被反复用，而
   * admin.maintenance_windows.title 上没有唯一约束）。此前 id 按标题算，两条待办会
   * 撞成同一个身份：页面上少一行（React key 重复）、告警的去重键也只剩一个。
   */
  it("同名的两个维护窗口是两条待办：身份取窗口主键，称呼仍是标题", () => {
    const window = (id: string) =>
      baseRow({
        kind: "maintenance_overdue",
        subject_type: "maintenance",
        subject_no: "例行维护",
        subject_key: id,
        order_no: null,
        tenant_name: null,
        amount_value: null,
        product_code: null,
        product_name: null,
        priority: 9,
      });
    const first = mapOpsTodoRow(window("aaaaaaaa-1111-4111-8111-111111111111"));
    const second = mapOpsTodoRow(
      window("bbbbbbbb-2222-4222-8222-222222222222"),
    );
    expect(first.id).not.toBe(second.id);
    // 称呼一样是对的——那就是运营给它们起的同一个名字。
    expect(first.subject.no).toBe("例行维护");
    expect(second.subject.no).toBe("例行维护");
  });

  /**
   * 身份**只在 id 里**。窗口主键是 UUID，而「任何场景不展示 UUID」是铁律，所以这一条
   * 逐个字段扫：除了 id，契约里任何一处都不许出现它。
   */
  it("维护窗口的身份不外溢：id 之外的任何字段都不含那个 uuid", () => {
    const uuid = "aaaaaaaa-1111-4111-8111-111111111111";
    const { id, ...rest } = mapOpsTodoRow(
      baseRow({
        kind: "maintenance_overdue",
        subject_type: "maintenance",
        subject_no: "数据库主从切换",
        subject_key: uuid,
        order_no: null,
        tenant_name: null,
        amount_value: null,
        product_code: null,
        product_name: null,
        priority: 9,
      }),
    );
    expect(id).toContain(uuid);
    expect(JSON.stringify(rest)).not.toContain(uuid);
    expect(JSON.stringify(rest)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });

  it("租户两类：无金额、无产品；认证去 /verifications，风险去租户详情（可读码）", () => {
    const tenantRow = baseRow({
      kind: "verification",
      subject_type: "tenant",
      subject_no: "200000010",
      order_no: null,
      amount_value: null,
      amount_paid: null,
      amount_currency: null,
      product_code: null,
      product_name: null,
      plan_name: null,
      severity: "amber",
      severity_effective: "amber",
      priority: 20,
    });
    expect(mapOpsTodoRow(tenantRow)).toMatchObject({
      progress: "verification",
      href: "/verifications",
      amount: null,
      product: null,
    });
    expect(
      mapOpsTodoRow({
        ...tenantRow,
        kind: "risk",
        severity: "rose",
        severity_effective: "rose",
        priority: 5,
      }),
    ).toMatchObject({ progress: "risk", href: "/tenants/200000010" });
  });

  it("工单：带 ticket 块、status 是库里的原值，进度按处理中 / 未接分两档", () => {
    const ticketRow = baseRow({
      kind: "ticket",
      subject_type: "ticket",
      subject_no: "TCK-1",
      order_no: null,
      amount_value: null,
      amount_paid: null,
      product_code: null,
      product_name: null,
      severity: "blue",
      severity_effective: "blue",
      priority: 30,
      ticket_title: "登录不了",
      ticket_priority: "p2",
      ticket_status: "open",
    });
    expect(mapOpsTodoRow(ticketRow)).toMatchObject({
      progress: "ticketOpen",
      href: "/tickets/TCK-1",
      ticket: { title: "登录不了", priority: "p2", status: "open" },
    });
    // 重开过的仍算「未接」（owner 要的完整性：它没关，就还在等人）。
    expect(
      mapOpsTodoRow({ ...ticketRow, ticket_status: "reopened" }),
    ).toMatchObject({
      progress: "ticketOpen",
      ticket: { title: "登录不了", priority: "p2", status: "reopened" },
    });
    expect(
      mapOpsTodoRow({ ...ticketRow, ticket_status: "in_progress" }).progress,
    ).toBe("ticketProcessing");
    expect(
      mapOpsTodoRow({ ...ticketRow, ticket_status: "pending" }).progress,
    ).toBe("ticketProcessing");
  });

  it("工单首响超时：另一类、紧急档，ticket 块照样带（邮件要说标题与优先级）", () => {
    expect(
      mapOpsTodoRow(
        baseRow({
          kind: "ticket_sla",
          subject_type: "ticket",
          subject_no: "TCK-2",
          order_no: null,
          amount_value: null,
          amount_paid: null,
          product_code: null,
          product_name: null,
          priority: 1,
          ticket_title: "支付页打不开",
          ticket_priority: "p0",
          ticket_status: "open",
        }),
      ),
    ).toMatchObject({
      id: "ticket_sla:TCK-2",
      progress: "ticketSla",
      severity: "rose",
      href: "/tickets/TCK-2",
      ticket: { title: "支付页打不开", priority: "p0", status: "open" },
    });
  });

  it("未知类别 / 严重度 / 主体类型不静默降档，直接抛", () => {
    expect(() => mapOpsTodoRow(baseRow({ kind: "nope" }))).toThrow(
      /未知待办类别/,
    );
    expect(() =>
      mapOpsTodoRow(baseRow({ severity_effective: "green" })),
    ).toThrow(/未知严重度/);
    expect(() => mapOpsTodoRow(baseRow({ subject_type: "invoice_x" }))).toThrow(
      /未知主体类型/,
    );
  });

  it("十九类都有进度键与主体类型（漏一档就在这里红）", () => {
    const subjectOf = (kind: OpsTodoKind): string => {
      if (kind.startsWith("refund_")) return "refund";
      if (kind === "subscription_overdue") return "subscription";
      if (kind.startsWith("invoice_")) return "invoice";
      if (kind === "addon_pending_confirm") return "addon";
      if (kind === "verification" || kind === "risk") return "tenant";
      if (kind === "ticket" || kind === "ticket_sla") return "ticket";
      if (kind === "maintenance_overdue") return "maintenance";
      if (kind === "deletion_pending" || kind === "purge_imminent")
        return "user";
      return "order";
    };
    expect(OPS_TODO_KINDS).toHaveLength(19);
    const progresses = new Set<string>();
    for (const kind of OPS_TODO_KINDS) {
      const todo = mapOpsTodoRow(
        baseRow({ kind, subject_type: subjectOf(kind) }),
      );
      expect(todo.progress, kind).toBeTruthy();
      progresses.add(todo.progress);
    }
    // 十九类里只有 ticket 的两个进度档共享一类，所以进度档数 = 19
    // （ticketOpen / ticketProcessing 二选一）。
    expect(progresses.size).toBe(19);
  });

  it("除维护窗口外，每一类都给得出链接，且链接里不出现 UUID", () => {
    const uuid =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const kind of OPS_TODO_KINDS) {
      const href = mapOpsTodoRow(
        baseRow({
          kind,
          subject_type:
            kind === "maintenance_overdue" ? "maintenance" : "order",
        }),
      ).href;
      if (kind === "maintenance_overdue") {
        expect(href).toBeNull();
      } else {
        expect(href, kind).toMatch(/^\//);
        expect(href!, kind).not.toMatch(uuid);
      }
    }
  });
});

describe("OpsTodoRepository.list", () => {
  it("把选项绑成九个参数、按类别拼 SQL，行经映射返回", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [baseRow({}), baseRow({ kind: "reprovision" })],
    });
    const repo = new OpsTodoRepository({ query } as unknown as Pool);
    const items = await repo.list({
      kinds: ["confirm_payment", "reprovision"],
      minAgeMinutes: 15,
      limit: 50,
    });
    expect(query).toHaveBeenCalledWith(
      buildListOpsTodosSql({ kinds: ["confirm_payment", "reprovision"] }),
      [["confirm_payment", "reprovision"], 15, 50, ...DEFAULT_THRESHOLD_PARAMS],
    );
    expect(items.map((i) => i.id)).toEqual([
      "confirm_payment:ORD-1",
      "reprovision:ORD-1",
    ]);
  });

  it("不传选项：全量那一拼、不过滤、默认上限", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new OpsTodoRepository({ query } as unknown as Pool);
    expect(await repo.list()).toEqual([]);
    expect(query).toHaveBeenCalledWith(LIST_OPS_TODOS_SQL, [
      null,
      null,
      DEFAULT_LIST_LIMIT,
      ...DEFAULT_THRESHOLD_PARAMS,
    ]);
  });

  it("告警作业那个调用形状：拼的正是「九类 + 不带富化块」那一版", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new OpsTodoRepository({ query } as unknown as Pool);
    await repo.list({
      kinds: ALERT_KINDS,
      minAgeMinutes: 15,
      limit: 50,
      includeApplicant: false,
    });
    expect(query).toHaveBeenCalledWith(ALERT_SQL, [
      [...ALERT_KINDS],
      15,
      50,
      ...DEFAULT_THRESHOLD_PARAMS,
    ]);
  });

  it("明确要零个类别：不发查询、回空列表", async () => {
    const query = vi.fn();
    const repo = new OpsTodoRepository({ query } as unknown as Pool);
    expect(await repo.list({ kinds: [] })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
