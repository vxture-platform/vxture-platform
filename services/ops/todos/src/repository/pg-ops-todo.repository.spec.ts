/**
 * pg-ops-todo.repository.spec.ts — 假 pool 下钉住：参数绑定、按类别拼片段、谓词字面、
 * 行 → 待办映射。
 *
 * 假 pool 不解析 SQL，所以谓词只能靠字面断言钉住（与 service-notice 同一手法）；
 * 真 SQL 的行为在 ops-todos.itest.spec.ts 打真库——包括「作业那一拼在
 * `set role svc_platform_api` 下跑得通」那一条，它才是最小权限那件事的真判据。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  DEFAULT_LIST_LIMIT,
  LIST_OPS_TODOS_SQL,
  OpsTodoRepository,
  TODO_COLUMN_ORDER,
  bindListOptions,
  buildListOpsTodosSql,
  mapOpsTodoRow,
  unionCteTexts,
  type OpsTodoRow,
} from "./pg-ops-todo.repository";
import { OPS_TODO_KINDS } from "../types";

const baseRow = (over: Partial<OpsTodoRow>): OpsTodoRow => ({
  kind: "confirm_payment",
  subject_type: "order",
  subject_no: "ORD-1",
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
  ...over,
});

/** 作业读的那一拼：三类 + 不带富化块。 */
const ALERT_SQL = buildListOpsTodosSql({
  kinds: ["confirm_payment", "reprovision", "refund_audit"],
  includeApplicant: false,
});

describe("bindListOptions", () => {
  it("不传选项 = 全类别、不按停留过滤、默认上限", () => {
    expect(bindListOptions()).toEqual([null, null, DEFAULT_LIST_LIMIT]);
  });

  it("告警作业的三个参数原样绑定", () => {
    expect(
      bindListOptions({
        kinds: ["confirm_payment", "reprovision", "refund_audit"],
        minAgeMinutes: 15,
        limit: 50,
      }),
    ).toEqual([["confirm_payment", "reprovision", "refund_audit"], 15, 50]);
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
});

describe("buildListOpsTodosSql：请求哪几类就只拼哪几段", () => {
  it("全量（页面那一拼）：五段 CTE 齐全，底座在，富化块在", () => {
    expect(LIST_OPS_TODOS_SQL).toBe(buildListOpsTodosSql());
    for (const cte of [
      "order_todos as (",
      "refund_todos as (",
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

  it("只要退款一类：订单 / 租户 / 工单那几段一个都不拼进文本", () => {
    const sql = buildListOpsTodosSql({ kinds: ["refund_audit"] });
    expect(sql).toContain("refund_todos as (");
    expect(sql).toContain("  select * from refund_todos");
    for (const absent of [
      "order_todos as (",
      "tenant_base as (",
      "ticket_todos as (",
      "from billing.orders o\n",
      "support.tickets k",
      "kyc.tenant_verifications",
      "session.auth_sessions",
    ]) {
      expect(sql).not.toContain(absent);
    }
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
});

describe("作业那一拼（includeApplicant: false）只碰 svc_platform_api 有权的 schema", () => {
  // 97_service_roles.sql 给 svc_platform_api 的 7 个 schema 之外的那几个。
  // 真判据在 itest（set role 之后真跑）；这里只钉住「文本里出现过没有」——
  // Postgres 查权限看的正是文本里出现过的关系，不管那一支返不返回行。
  const forbidden = [
    "account.",
    "admin.",
    "kyc.",
    "session.",
    "support.",
    "identity.",
    "credential.",
    "access.",
    "loyalty.",
    "appoidc.",
    "safety.",
    "tenancy.tenant_contacts",
  ];

  it("一个越界 schema 都不出现", () => {
    for (const needle of forbidden) {
      expect(ALERT_SQL).not.toContain(needle);
    }
  });

  it("该在的还在：订单 / 退款两段 + 三个绑定参数", () => {
    expect(ALERT_SQL).toContain("from billing.orders o");
    expect(ALERT_SQL).toContain("from billing.refunds r");
    expect(ALERT_SQL).toContain("join tenancy.tenants t");
    expect(ALERT_SQL).toContain("left join tenancy.tenant_profiles tp");
    expect(ALERT_SQL).toMatch(/limit \$3::int\s*$/);
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
    it(`includeApplicant=${includeApplicant}：五段的列名与顺序都等于 TODO_COLUMN_ORDER`, () => {
      const ctes = unionCteTexts(includeApplicant);
      expect(ctes.map((c) => c.name)).toEqual([
        "order_todos",
        "refund_todos",
        "verification_todos",
        "risk_todos",
        "ticket_todos",
      ]);
      for (const cte of ctes) {
        expect(aliasesOf(cte.sql), cte.name).toEqual([...TODO_COLUMN_ORDER]);
      }
    });
  }

  it("OpsTodoRow 的字段与投影列一一对上（多一列少一列在这里红）", () => {
    const row = baseRow({});
    expect(Object.keys(row).sort()).toEqual([...TODO_COLUMN_ORDER].sort());
  });
});

describe("LIST_OPS_TODOS_SQL 的谓词字面", () => {
  it("三个参数都写成「为空即不过滤」的谓词，limit 绑定", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "($1::text[] is null or x.kind = any($1::text[]))",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "($2::int is null or x.waiting_since + make_interval(mins => $2::int) <= now())",
    );
    expect(LIST_OPS_TODOS_SQL).toMatch(/limit \$3::int\s*$/);
  });

  it("排序 = 严重度 → 优先级 → 等待起点升序", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "order by severity_rank, priority, waiting_since asc",
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
    expect(pairs).toEqual([
      ["pending_verify", "confirm_payment"],
      ["paid", "reprovision"],
      ["pending_payment", "follow_up_balance"],
    ]);
    // 尾款挂账只在最近账单 partial 时成立——与 orders.router 的 partial_pending 同口径。
    expect(LIST_OPS_TODOS_SQL).toContain(
      "or (o.status = 'pending_payment' and inv.bill_status = 'partial')",
    );
    // 已收多少只有尾款挂账那一类带（其余类别 amount.paid = null）。
    expect(LIST_OPS_TODOS_SQL).toContain(
      "case when o.status = 'pending_payment' then inv.paid_amount::text end as amount_paid",
    );
  });

  it("退款：审核 pending 且执行 pending；工单：库里没结的四个状态；租户：认证 pending / 风险 / 停用", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where r.audit_status = 'pending' and r.refund_status = 'pending'",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "and k.status not in ('resolved', 'closed', 'cancelled')",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where verification_status = 'pending'",
    );
    expect(LIST_OPS_TODOS_SQL).toContain(
      "where coalesce(risk_level, 'normal') <> 'normal' or status = 'suspended'",
    );
  });

  it("工单严重度：p0 或 reopened 才 rose；CHECK 之外的状态词一个都不判", () => {
    expect(LIST_OPS_TODOS_SQL).toContain(
      "when k.priority = 'p0' or k.status = 'reopened' then 'rose'",
    );
    // 库里没有这些值（72_support.sql 的 chk_tickets_status），判它们只是自欺。
    for (const dead of ["'blocked'", "'waiting'", "'new'", "'processing'"]) {
      expect(LIST_OPS_TODOS_SQL).not.toContain(dead);
    }
    // 状态原样下发，不在 SQL 里归一——页面要显示「重开」就得看得见 reopened。
    expect(LIST_OPS_TODOS_SQL).toContain("k.status                       ");
  });

  it("SELECT 里没有任何 uuid 主键列——只出可视码", () => {
    const union = LIST_OPS_TODOS_SQL.slice(
      LIST_OPS_TODOS_SQL.indexOf(", todos as ("),
    );
    expect(union).not.toMatch(/\bx\.id\b/);
    expect(LIST_OPS_TODOS_SQL).not.toMatch(/\bo\.id\s+as\b/);
    expect(LIST_OPS_TODOS_SQL).not.toMatch(/\br\.id\s+as\b/);
    expect(LIST_OPS_TODOS_SQL).not.toMatch(/\bk\.id\s+as\b/);
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
    });
    expect(todo.ticket).toBeUndefined();
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

  it("退款审核：主体是退款单号，href 落到订单详情，找不到订单退回列表", () => {
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

  it("未知类别 / 严重度不静默降档，直接抛", () => {
    expect(() => mapOpsTodoRow(baseRow({ kind: "nope" }))).toThrow(
      /未知待办类别/,
    );
    expect(() => mapOpsTodoRow(baseRow({ severity: "green" }))).toThrow(
      /未知严重度/,
    );
  });

  it("类别值域与进度键值域一一覆盖（漏一档就在这里红）", () => {
    for (const kind of OPS_TODO_KINDS) {
      const row = baseRow({
        kind,
        subject_type:
          kind === "refund_audit"
            ? "refund"
            : kind === "verification" || kind === "risk"
              ? "tenant"
              : kind === "ticket"
                ? "ticket"
                : "order",
      });
      expect(mapOpsTodoRow(row).progress).toBeTruthy();
    }
  });
});

describe("OpsTodoRepository.list", () => {
  it("把选项绑成三个参数、按类别拼 SQL，行经映射返回", async () => {
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
      [["confirm_payment", "reprovision"], 15, 50],
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
    ]);
  });

  it("告警作业那个调用形状：拼的正是「三类 + 不带富化块」那一版", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new OpsTodoRepository({ query } as unknown as Pool);
    await repo.list({
      kinds: ["confirm_payment", "reprovision", "refund_audit"],
      minAgeMinutes: 15,
      limit: 50,
      includeApplicant: false,
    });
    expect(query).toHaveBeenCalledWith(ALERT_SQL, [
      ["confirm_payment", "reprovision", "refund_audit"],
      15,
      50,
    ]);
  });

  it("明确要零个类别：不发查询、回空列表", async () => {
    const query = vi.fn();
    const repo = new OpsTodoRepository({ query } as unknown as Pool);
    expect(await repo.list({ kinds: [] })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
