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
  /** billing.invoice_items.item_name, e.g. "Arda Pro" */
  itemName: string;
  /** 付款时效（分钟，个人 30 / 组织 2880）；omitted → 读取端回退 env */
  paymentTtlMinutes?: number;
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
