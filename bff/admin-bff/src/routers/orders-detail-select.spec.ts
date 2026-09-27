import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mapHistoryRow,
  mapOrderRow,
  type HistoryRow,
  type OrderRow,
} from "./orders.router";

/**
 * orders-detail-select.spec.ts —— 订单详情查询必须把申报腿的列写进 SELECT。
 *
 * 2026-09-27 生产实单抓到：`ORDER_BASE_SQL` 把 `pending_verify` 现金腿 lateral join
 * 成 `declared`，SELECT 列表却一列都没投影，于是 `mapOrderRow` 里 `row.declared_at`
 * 恒为 undefined、接口的 `declaredPayment` 恒为 null——admin 上「客户申报」块与
 * 「驳回申报」按钮（都以它为条件）从上线那天起就没出现过，确认弹窗也锁不住申报金额。
 * SQL 里的 join 与 SELECT 是两处，漏一处不报错，只是接口少一块；这里按源码钉住。
 *
 * 同日详情页重构又补了一批列（意图 / 金额构成 / 关闭原因 / TTL 与锚点 / 申报人 / 租户
 * 联系人 / 履约订阅）与时间线的操作者显示名——同一种病（join 了没 SELECT、SELECT 了
 * 没进记录）在这批列上一样会犯，所以源码与映射两头都钉。
 */
const SRC = readFileSync(resolve(__dirname, "orders.router.ts"), "utf8");

function selectListOf(marker: string, fromClause: string): string {
  const start = SRC.indexOf(marker);
  const from = SRC.indexOf(fromClause, start);
  expect(start).toBeGreaterThan(-1);
  expect(from).toBeGreaterThan(start);
  return SRC.slice(start, from);
}

describe("订单详情 SELECT 投影申报腿", () => {
  it("ORDER_BASE_SQL 的 SELECT 列表含 declared.* 六列，且都在 from 之前", () => {
    const selectList = selectListOf(
      "const ORDER_BASE_SQL = `",
      "from billing.orders ord",
    );
    for (const col of [
      "declared.declared_channel",
      "declared.declared_payer",
      "declared.declared_transaction_no",
      "declared.declared_remark",
      "declared.declared_amount",
      "declared.declared_at",
    ]) {
      expect(selectList).toContain(col);
    }
  });

  it("映射以 declared_at 为开关：SELECT 里的列名与映射读的列名一致", () => {
    /* 反面：SELECT 投影了却起了别的别名，映射仍然读不到——所以两头都要对。 */
    expect(SRC).toMatch(/declaredPayment: row\.declared_at/);
    for (const col of [
      "row.declared_channel",
      "row.declared_payer",
      "row.declared_transaction_no",
      "row.declared_remark",
      "row.declared_amount",
    ]) {
      expect(SRC).toContain(col);
    }
  });
});

describe("订单详情 SELECT 投影重构补的列（2026-09-27）", () => {
  const selectList = () =>
    selectListOf("const ORDER_BASE_SQL = `", "from billing.orders ord");

  it("订单实体列：意图 / 自动续费 / 金额三列 / 关闭原因 / TTL", () => {
    for (const col of [
      "ord.intent",
      "ord.auto_renew",
      "ord.list_amount",
      "ord.credit_amount",
      "ord.leftover_amount",
      "ord.close_reason",
      "ord.payment_ttl_minutes",
    ]) {
      expect(selectList()).toContain(col);
    }
  });

  it("付款倒计时锚点与超时扫描同一公式：greatest(created_at, 最近 payment_rejected)", () => {
    const list = selectList();
    expect(list).toContain("as ttl_anchor");
    expect(list).toMatch(
      /greatest\(\s*ord\.created_at,\s*coalesce\(\(\s*select max\(e\.created_at\) from billing\.order_events e\s*where e\.order_id = ord\.id and e\.event_type = 'payment_rejected'\s*\), ord\.created_at\)\s*\)/,
    );
  });

  it("履约订阅三列（start / end / auto_renew）与申报人、租户联系人", () => {
    for (const col of [
      "tsub.start_at",
      "tsub.end_at",
      "tsub.auto_renew",
      "dup.display_name",
      "du.account",
      "du.email",
      "du.phone",
      "bc.contact_type",
      "bc.name",
      "bc.email",
      "bc.phone",
    ]) {
      expect(selectList()).toContain(col);
    }
  });

  it("申报腿 lateral 带出 actor_id 且按 customer 解到 account.users(+profiles)", () => {
    const lateral = SRC.slice(
      SRC.indexOf(
        "p.pay_status = 'pending_verify'",
        SRC.indexOf("const ORDER_BASE_SQL"),
      ),
    );
    expect(SRC).toContain("p.actor_id       as declared_actor_id");
    expect(lateral).toMatch(
      /left join account\.users du\s+on du\.id = declared\.declared_actor_id and declared\.declared_actor_type = 'customer'/,
    );
    expect(lateral).toContain(
      "left join account.user_profiles dup on dup.user_id = du.id",
    );
  });

  it("租户联系人只在 billing / primary 里挑，billing 优先", () => {
    expect(SRC).toMatch(
      /from tenancy\.tenant_contacts c\s+where c\.tenant_id = tenant\.id and c\.contact_type in \('billing', 'primary'\)\s+order by \(c\.contact_type = 'billing'\) desc, \(c\.contact_type = 'primary'\) desc/,
    );
  });

  it("SELECT 里不投影申报人 / 联系人的 id——UUID 不进 payload", () => {
    const list = selectList();
    expect(list).not.toMatch(/\bdu\.id\b/);
    expect(list).not.toMatch(/\bbc\.id\b/);
    expect(list).not.toContain("declared_actor_id");
  });
});

describe("时间线 SQL 解操作者显示名", () => {
  const timelineSql = () => {
    const start = SRC.indexOf("const TIMELINE_SQL = `");
    const end = SRC.indexOf("`;", start);
    expect(start).toBeGreaterThan(-1);
    return SRC.slice(start, end);
  };

  it("订单事件与订阅历史两段都各自 join operator_account 与 users(+profiles)", () => {
    const sql = timelineSql();
    const [orderPart, subPart] = sql.split("union all");
    expect(subPart).toBeDefined();
    for (const part of [orderPart, subPart as string]) {
      expect(part).toMatch(
        /left join admin\.operator_account op\s+on op\.id = \w\.actor_id and \w\.actor_type = 'operator'/,
      );
      expect(part).toMatch(
        /left join account\.users cu\s+on cu\.id = \w\.actor_id and \w\.actor_type = 'customer'/,
      );
      expect(part).toContain(
        "left join account.user_profiles cup on cup.user_id = cu.id",
      );
      expect(part).toContain("as operator_name");
      expect(part).toContain("as customer_display_name");
      expect(part).toContain("as customer_account");
    }
  });

  it("两段分别标 event_group = order / subscription", () => {
    const sql = timelineSql();
    expect(sql).toContain("'order'            as event_group");
    expect(sql).toContain("'subscription'     as event_group");
  });

  it("投影列表里不再有 actor_id（只在 join 条件里出现）", () => {
    const sql = timelineSql();
    const orderSelect = sql.slice(
      sql.indexOf("select e.id"),
      sql.indexOf("from billing.order_events"),
    );
    const subSelect = sql.slice(
      sql.indexOf("select h.id"),
      sql.indexOf("from metering.subscription_histories"),
    );
    expect(orderSelect).not.toContain("actor_id");
    expect(subSelect).not.toContain("actor_id");
  });
});

// ────────────────────────── 映射：mapOrderRow ──────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ORDER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUB_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BILL_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PAY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const CREATED_AT = new Date("2026-09-27T01:11:00.000Z");

function baseRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    order_no: "ORD-202609-A714C75EC8",
    order_entity_status: "pending_verify",
    order_intent: "new",
    cycle_unit: "month",
    order_payable_amount: "199.00",
    currency: "CNY",
    created_by_type: "customer",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    fulfilled_subscription_id: null,
    target_subscription_status: null,
    order_auto_renew: false,
    order_list_amount: "199.00",
    order_credit_amount: "0.00",
    order_leftover_amount: "0.00",
    order_close_reason: null,
    order_payment_ttl_minutes: 2880,
    ttl_anchor: CREATED_AT,
    target_subscription_start_at: null,
    target_subscription_end_at: null,
    target_subscription_auto_renew: null,
    declared_by_display_name: "Stone Smoker",
    declared_by_account: "stonesmoker",
    declared_by_email: "stone@example.com",
    declared_by_phone: "13812345678",
    billing_contact_type: "billing",
    billing_contact_name: "财务张",
    billing_contact_email: "finance@example.com",
    billing_contact_phone: "13900001111",
    tier_code: "pro",
    tenant_id: TENANT_ID,
    tenant_code: "2143889307",
    tenant_name: "如影智能科技有限公司",
    tenant_type: "organization",
    industry: null,
    plan_code: "tender-pro",
    plan_name: "标书编写智能体 Pro",
    operator_name: null,
    bill_id: BILL_ID,
    bill_no: "INV-202609-0000000001",
    bill_status: "unpaid",
    bill_payable_amount: "199.00",
    bill_paid_amount: "0.00",
    bill_paid_at: null,
    payment_id: PAY_ID,
    payment_no: "PAY-202609-0000000001",
    pay_source: "offline",
    pay_method: null,
    pay_status: "pending_verify",
    payment_paid_amount: "0.00",
    payment_paid_at: null,
    declared_channel: "alipay",
    declared_payer: "张三",
    declared_transaction_no: "2026092722001",
    declared_remark: null,
    declared_amount: "199.00",
    declared_at: new Date("2026-09-27T09:11:00.000Z"),
    refund_id: null,
    refund_no: null,
    refund_amount: null,
    refund_reason: null,
    refund_audit_status: null,
    refund_audit_remark: null,
    refund_status: null,
    refund_requested_at: null,
    refund_audited_at: null,
    refund_refunded_at: null,
    ...overrides,
  };
}

/** 递归收集对象里所有字符串值，供「不含 UUID」断言。 */
function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringLeaves(v, out));
  else if (value && typeof value === "object")
    Object.values(value as Record<string, unknown>).forEach((v) =>
      stringLeaves(v, out),
    );
  return out;
}

describe("mapOrderRow：重构补的字段", () => {
  const savedTtlEnv = process.env["ORDER_PAYMENT_TTL_MINUTES"];
  beforeEach(() => {
    delete process.env["ORDER_PAYMENT_TTL_MINUTES"];
  });
  afterEach(() => {
    if (savedTtlEnv === undefined)
      delete process.env["ORDER_PAYMENT_TTL_MINUTES"];
    else process.env["ORDER_PAYMENT_TTL_MINUTES"] = savedTtlEnv;
  });

  it("意图 / 自动续费 / 金额构成 / 关闭原因原样进记录", () => {
    const rec = mapOrderRow(
      baseRow({
        order_intent: "upgrade",
        order_auto_renew: true,
        order_list_amount: "299.00",
        order_credit_amount: "100.00",
        order_leftover_amount: "0.00",
      }),
    );
    expect(rec.intent).toBe("upgrade");
    expect(rec.autoRenew).toBe(true);
    expect(rec.listAmount).toBe(299);
    expect(rec.creditAmount).toBe(100);
    expect(rec.leftoverAmount).toBe(0);
    expect(rec.closeReason).toBeNull();
  });

  it("已申报：时钟冻结，expireAt 不给", () => {
    const rec = mapOrderRow(baseRow({ order_entity_status: "pending_verify" }));
    expect(rec.paymentDeadline).toEqual({ expireAt: null, frozen: true });
  });

  it("待付款：expireAt = 锚点 + 单上的 TTL（组织 48 小时）", () => {
    const anchor = new Date("2026-09-27T05:00:00.000Z");
    const rec = mapOrderRow(
      baseRow({
        order_entity_status: "pending_payment",
        pay_status: null,
        declared_at: null,
        ttl_anchor: anchor,
        order_payment_ttl_minutes: 2880,
      }),
    );
    expect(rec.paymentDeadline).toEqual({
      expireAt: new Date(anchor.getTime() + 2880 * 60_000).toISOString(),
      frozen: false,
    });
  });

  it("待付款：驳回过的单以驳回时刻为锚（锚点由 SQL 给，映射不回退到 created_at）", () => {
    const rejectedAt = new Date("2026-09-28T02:00:00.000Z");
    const rec = mapOrderRow(
      baseRow({
        order_entity_status: "pending_payment",
        pay_status: "failed",
        declared_at: null,
        created_at: CREATED_AT,
        ttl_anchor: rejectedAt,
        order_payment_ttl_minutes: 30,
      }),
    );
    expect(rec.paymentDeadline?.expireAt).toBe(
      new Date(rejectedAt.getTime() + 30 * 60_000).toISOString(),
    );
  });

  it("待付款：存量无 TTL 的单按 env 兜底（未配置 = 30 分钟，与超时扫描同值）", () => {
    const rec = mapOrderRow(
      baseRow({
        order_entity_status: "pending_payment",
        pay_status: null,
        declared_at: null,
        order_payment_ttl_minutes: null,
      }),
    );
    expect(rec.paymentDeadline?.expireAt).toBe(
      new Date(CREATED_AT.getTime() + 30 * 60_000).toISOString(),
    );
  });

  it("待付款但账上已有钱（存量部分到账）：超时扫描不碰它，没有截止", () => {
    const rec = mapOrderRow(
      baseRow({
        order_entity_status: "pending_payment",
        bill_status: "partial",
        bill_paid_amount: "100.00",
        pay_status: "paid",
        declared_at: null,
      }),
    );
    expect(rec.paymentDeadline).toBeNull();
  });

  it("已履约 / 已关闭：没有倒计时", () => {
    expect(
      mapOrderRow(
        baseRow({
          order_entity_status: "fulfilled",
          fulfilled_subscription_id: SUB_ID,
          target_subscription_status: "active",
        }),
      ).paymentDeadline,
    ).toBeNull();
    expect(
      mapOrderRow(baseRow({ order_entity_status: "cancelled" }))
        .paymentDeadline,
    ).toBeNull();
  });

  it("申报人：没有 pii 权限时邮箱 / 手机掩码，有权限时明文", () => {
    const masked = mapOrderRow(baseRow(), { canReadPii: false });
    expect(masked.declaredBy).toEqual({
      displayName: "Stone Smoker",
      email: "s***@example.com",
      phone: "138****5678",
    });
    const plain = mapOrderRow(baseRow(), { canReadPii: true });
    expect(plain.declaredBy).toEqual({
      displayName: "Stone Smoker",
      email: "stone@example.com",
      phone: "13812345678",
    });
    // 默认（不传选项）按无权限处理——漏传选项不能变成漏掩码。
    expect(mapOrderRow(baseRow()).declaredBy?.email).toBe("s***@example.com");
  });

  it("申报人：没有显示名回落到登录句柄；没有申报腿为 null", () => {
    expect(
      mapOrderRow(baseRow({ declared_by_display_name: null })).declaredBy
        ?.displayName,
    ).toBe("stonesmoker");
    expect(
      mapOrderRow(
        baseRow({
          declared_by_display_name: null,
          declared_by_account: null,
          declared_by_email: null,
          declared_by_phone: null,
        }),
      ).declaredBy,
    ).toBeNull();
  });

  it("租户联系人：billing 行原样；没有联系人为 null", () => {
    expect(mapOrderRow(baseRow()).billingContact).toEqual({
      contactType: "billing",
      name: "财务张",
      email: "finance@example.com",
      phone: "13900001111",
    });
    expect(
      mapOrderRow(
        baseRow({ billing_contact_type: null, billing_contact_name: null }),
      ).billingContact,
    ).toBeNull();
  });

  it("履约订阅：未履约 null（不再是「暂停」的占位）；履约后带状态与生效期", () => {
    expect(mapOrderRow(baseRow()).fulfilledSubscription).toBeNull();
    const start = new Date("2026-09-27T09:30:00.000Z");
    const end = new Date("2026-10-27T09:30:00.000Z");
    const rec = mapOrderRow(
      baseRow({
        order_entity_status: "fulfilled",
        fulfilled_subscription_id: SUB_ID,
        target_subscription_status: "active",
        target_subscription_start_at: start,
        target_subscription_end_at: end,
        target_subscription_auto_renew: true,
      }),
    );
    expect(rec.fulfilledSubscription).toEqual({
      status: "active",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      autoRenew: true,
    });
  });

  it("关闭原因随已关闭的单下发", () => {
    const rec = mapOrderRow(
      baseRow({
        order_entity_status: "cancelled",
        order_close_reason: "operator_void",
        pay_status: null,
        declared_at: null,
      }),
    );
    expect(rec.orderStatus).toBe("closed");
    expect(rec.closeReason).toBe("operator_void");
  });

  it("新字段里没有任何 UUID（行上所有 id 列都是 UUID 也不漏出）", () => {
    const rec = mapOrderRow(
      baseRow({
        order_entity_status: "fulfilled",
        fulfilled_subscription_id: SUB_ID,
        target_subscription_status: "active",
      }),
    );
    const leaves = stringLeaves({
      intent: rec.intent,
      closeReason: rec.closeReason,
      paymentDeadline: rec.paymentDeadline,
      declaredBy: rec.declaredBy,
      billingContact: rec.billingContact,
      fulfilledSubscription: rec.fulfilledSubscription,
    });
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) expect(leaf).not.toMatch(UUID_RE);
  });
});

// ────────────────────────── 映射：mapHistoryRow ──────────────────────────

function historyRow(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    change_type: "payment_rejected",
    event_group: "order",
    from_status: "pending_verify",
    to_status: "pending_payment",
    remark: "实收 100 与申报不符",
    actor_type: "operator",
    created_at: new Date("2026-09-27T09:40:00.000Z"),
    operator_name: "运营小王",
    customer_display_name: null,
    customer_account: null,
    ...overrides,
  };
}

describe("mapHistoryRow：机器词 + 显示名，旧字段照旧", () => {
  it("运营事件：kind / group / 状态 / 备注 / 显示名各就各位", () => {
    const ev = mapHistoryRow(historyRow());
    expect(ev).toMatchObject({
      kind: "payment_rejected",
      group: "order",
      actorType: "operator",
      actorName: "运营小王",
      fromStatus: "pending_verify",
      toStatus: "pending_payment",
      remark: "实收 100 与申报不符",
      tone: "warning",
      at: "2026-09-27T09:40:00.000Z",
    });
    // 兼容字段（尚未改造的读者）
    expect(ev.title).toBe("payment_rejected");
    expect(ev.actor).toBe("operator");
    expect(ev.description).toBe("实收 100 与申报不符");
  });

  it("客户事件：显示名优先，没有则登录句柄", () => {
    expect(
      mapHistoryRow(
        historyRow({
          change_type: "payment_declared",
          actor_type: "customer",
          operator_name: null,
          customer_display_name: "Stone Smoker",
          customer_account: "stonesmoker",
        }),
      ).actorName,
    ).toBe("Stone Smoker");
    expect(
      mapHistoryRow(
        historyRow({
          actor_type: "customer",
          operator_name: null,
          customer_display_name: null,
          customer_account: "stonesmoker",
        }),
      ).actorName,
    ).toBe("stonesmoker");
  });

  it("系统事件与查不到的人：actorName 为 null，不编名字", () => {
    expect(
      mapHistoryRow(
        historyRow({
          change_type: "order_expired",
          actor_type: "system",
          operator_name: null,
        }),
      ),
    ).toMatchObject({ actorType: "system", actorName: null, tone: "danger" });
    expect(
      mapHistoryRow(historyRow({ operator_name: null })).actorName,
    ).toBeNull();
  });

  it("订阅历史行标成 subscription 组；来路不明的组归 order", () => {
    expect(
      mapHistoryRow(
        historyRow({
          change_type: "renewed",
          event_group: "subscription",
          actor_type: "system",
        }),
      ).group,
    ).toBe("subscription");
    expect(mapHistoryRow(historyRow({ event_group: "" })).group).toBe("order");
  });

  it("退款五种事件都有语气，不落到 neutral 默认", () => {
    const tones = Object.fromEntries(
      [
        "refund_requested",
        "refund_approved",
        "refund_rejected",
        "refunded",
        "refund_failed",
      ].map((k) => [k, mapHistoryRow(historyRow({ change_type: k })).tone]),
    );
    expect(tones).toEqual({
      refund_requested: "warning",
      refund_approved: "neutral",
      refund_rejected: "warning",
      refunded: "danger",
      refund_failed: "danger",
    });
  });

  it("时间线字段里没有 UUID（id 除外——它是 React key，不上屏）", () => {
    const ev = mapHistoryRow(historyRow());
    const rest = { ...ev, id: "" };
    for (const leaf of stringLeaves(rest)) expect(leaf).not.toMatch(UUID_RE);
  });
});
