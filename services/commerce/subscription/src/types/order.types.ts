/**
 * order.types.ts — 订单实体（billing.orders）类型（product_330 P1-b2）
 * @package @vxture/service-subscription
 *
 * 订单 = 钱、意图、履约态的载体；订阅只回答"现在有什么"。订单阶段不再产生订阅行，
 * 履约（fulfill）是订单→订阅的唯一入口。
 */

export type OrderIntent = "new" | "upgrade" | "renew";

export type OrderStatus =
  | "pending_payment"
  | "pending_verify"
  | "paid"
  | "fulfilled"
  | "cancelled"
  | "expired"
  | "refunded";

export type OrderActorType = "customer" | "operator" | "system";

export interface OrderRecord {
  id: string;
  orderNo: string;
  tenantId: string;
  workspaceId: string;
  productId: string;
  planVersionId: string;
  intent: OrderIntent;
  cycleUnit: string;
  cycleCount: number;
  fromSubscriptionId: string | null;
  subscriptionId: string | null;
  /** NUMERIC(12,2) yuan strings（资金类两位小数，不走浮点）。 */
  listAmount: string;
  creditAmount: string;
  payableAmount: string;
  leftoverAmount: string;
  currency: string;
  proration: Record<string, unknown> | null;
  status: OrderStatus;
  paymentTtlMinutes: number | null;
  /** 客户在确认页的自动续费选择（owner 2026-09-03：默认关、需用户开启）；履约时写入订阅。 */
  autoRenew: boolean;
  declaredAt: Date | null;
  paidAt: Date | null;
  fulfilledAt: Date | null;
  closedAt: Date | null;
  closeReason: string | null;
  createdByType: OrderActorType;
  createdById: string | null;
  operatorRemark: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderActor {
  actorType: OrderActorType;
  /** null for system actors（jobs have no uuid）。 */
  actorId: string | null;
  remark?: string;
  clientIp?: string;
}

export interface CreateOrderInput {
  tenantId: string;
  workspaceId: string;
  planVersionId: string;
  /** 'month' | 'year' — must have a matching product.plan_prices row */
  cycleUnit: string;
  price: number;
  currency?: string;
  /** 下单人；系统自动续费单为 null（created_by_type='system'）。 */
  createdBy: string | null;
  /** 默认 customer；自动续费引擎传 system。 */
  createdByType?: OrderActorType;
  intent: OrderIntent;
  /** required when intent = upgrade | renew：原订阅 */
  fromSubscriptionId?: string;
  /**
   * 跨版本续订的客户确认（owner 2026-09-22）：值必须**等于原订阅当前钉着的版本 id**。
   *
   * 续订会把订阅落到套餐当前在售的那一版，内容可能与他当初买的不同（价格增减、配额
   * 增减、权益增删）。客户要有知情权与决策权，所以差异得看过、并由客户端把「看到的是
   * 哪一版」回送过来。期间若又发布了新版，`from` 已经变了，旧确认自然失效——他必须
   * 重新看一遍。
   *
   * 它同时是**自动续订的护栏**：自动续费引擎（`createdByType: "system"`）送不出这个
   * 值，于是天然跨不了版本。fail closed，而不是靠注释提醒后人。
   * 现状：`auto_renew` 只是个开关，`next_renewal_at` 全仓无写入方、无作业。
   */
  acceptVersionChangeFrom?: string;
  /** billing.invoice_items.item_name, e.g. "Arda Pro" */
  itemName: string;
  /** 付款时效（分钟，个人 30 / 组织 2880）；omitted → 读取端回退 env */
  paymentTtlMinutes?: number;
  /**
   * 自动续费（owner 2026-09-03）：默认 false，客户在订单确认页显式开启；
   * 履约时写入订阅（new 建订阅带上；renew / upgrade 按订单值更新）。系统自动续费单固定 true。
   */
  autoRenew?: boolean;
  /**
   * 升级折抵（product_330 §4.1，P2-a）：由 OrderService.quoteUpgrade 算出后随单落库——
   * credit 抵扣标价（账单落一条 credit_adjustment 负行），leftover 履约时进预付款余额，
   * snapshot 原样写 orders.proration 供确认页 / 账单明细追溯。
   */
  proration?: {
    credit: number;
    payable: number;
    leftover: number;
    snapshot: Record<string, unknown>;
  };
}

export interface CreateOrderResult {
  order: OrderRecord;
  invoiceId: string;
  billNo: string;
}

// ── 退款（product_330 §5，owner 决策 3）────────────────────────────────────────

/** 平台参数（admin.settings）：退款窗口与消耗性配额使用率阈值。 */
export interface RefundPolicy {
  windowHours: number;
  maxUsageRatio: number;
}

export interface RefundEligibility {
  eligible: boolean;
  /** 不满足的原因码（全部列出，前端按码翻译） */
  reasons: RefundIneligibleReason[];
  /**
   * 可退金额。2026-09-25 起**按已消耗配额折算**（owner：「我们有成本」），不再恒等于实付：
   *   amount = round2(实付 × (1 − α × 已用比))
   * 无消耗性池 / 一点没用 → 等于实付（与此前一致）。
   */
  amount: string;
  currency: string;
  /** 本单实付（折算前），给界面把「退多少 / 留多少」说清楚 */
  paidAmount: string;
  /** 平台留下的那一份 = paidAmount − amount，只因为配额被消耗掉了 */
  keptAmount: string;
  /** 折算用的 α（套餐主组件 consumable_share；套餐没声明时是默认值） */
  consumableShare: number;
  /** 窗口截止时刻（fulfilled_at + windowHours） */
  windowEndsAt: Date | null;
  /** 消耗性配额已用比 [0,1]（无池 0） */
  usageRatio: number;
  policy: RefundPolicy;
}

export type RefundIneligibleReason =
  | "not_fulfilled"
  | "not_first_purchase"
  | "window_elapsed"
  /**
   * 2026-09-25 起**不再产生**：折算退之后「用多了」的答案是退得少，不是不退。
   * 保留这个码与 `policy.maxUsageRatio` 那个开关——将来若要重新立「用超多少就不得退」
   * 的规则，两样都是现成的。前端的文案也留着。
   */
  | "usage_over_threshold"
  | "zero_amount"
  /** 折算下来一分都不该退（α=1 且配额用尽）。开一张 ¥0 的退款单对客户是个假象。 */
  | "fully_consumed"
  | "refund_exists";

export interface RefundRecordView {
  id: string;
  refundNo: string;
  orderId: string;
  amount: string;
  currency: string;
  reason: string | null;
  auditStatus: "pending" | "approved" | "rejected";
  auditRemark: string | null;
  refundStatus: "pending" | "processing" | "success" | "failed";
  requestedAt: Date;
  auditedAt: Date | null;
  refundedAt: Date | null;
}

/** 订单账单（锁定后交给申报编排）。 */
export interface OrderInvoice {
  id: string;
  billNo: string;
  billStatus: string;
  totalAmount: string;
  payableAmount: string;
  paidAmount: string;
  currency: string;
}

export interface OrderEventRecord {
  id: string;
  orderId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorType: string;
  actorId: string | null;
  remark: string | null;
  clientIp: string | null;
  createdAt: Date;
}

/**
 * 运营待办告警（#231）的候选单。两个状态就是原始订单态：
 * `pending_verify`（客户已申报付款，等运营确认收款）、
 * `paid`（钱已到、权益没开通——运营页显示为「已收款未开通」）。
 */
export interface OpsTodoOrderRow {
  id: string;
  orderNo: string;
  status: "pending_verify" | "paid";
  tenantName: string;
  payableAmount: number;
  currency: string;
  /** 从这一刻起就在等人处理（申报时间 / 到账时间）。 */
  waitingSince: Date;
}
