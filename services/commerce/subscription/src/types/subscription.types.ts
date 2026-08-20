export enum BillingCycle {
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  ANNUAL = "annual",
  YEARLY = "yearly",
}

/**
 * Enum form of @vxture/shared SUBSCRIPTION_STATUSES (needed by class-validator
 * IsEnum). Values MUST stay identical to the @shared value domain — the DB
 * CHECK enforces that set, so any drift here (like the retired "paused", which
 * the DDL never allowed) makes the DTO accept writes the DB rejects, or reject
 * states the DB holds. Asserted by subscription.types.spec.ts.
 */
export enum SubscriptionStatus {
  ACTIVE = "active",
  EXPIRING = "expiring",
  TRIALING = "trialing",
  OVERDUE = "overdue",
  SUSPENDED = "suspended",
  EXPIRED = "expired",
  CANCELLED = "cancelled",
}

export interface SubscriptionRecord {
  id: string;
  tenantId: string; // billing rollup account (org/tenant)
  workspaceId: string; // cost center that holds the subscription (ADR-11)
  planVersionId: string; // pinned immutable plan_version
  cycleType: string;
  cycleCount: number;
  startAt: Date;
  endAt: Date | null;
  trialEndAt: Date | null;
  status: string;
  subscriptionKind: string; // paid/trial/free
  activationMethod: string; // online_purchase/offline_purchase/redemption/operator_grant/trial/free
  autoRenew: boolean;
  orderNo: string | null;
  payAmount: string | null;
  currency: string;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface SubscriptionHistoryRecord {
  id: string;
  tenantId: string;
  subscriptionId: string;
  changeType: string;
  fromPlanVersionId: string | null;
  toPlanVersionId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  operatorType: string;
  operatorId: string | null;
  operatorRemark: string | null;
  clientIp: string | null;
  createdAt: Date;
}

export interface ListSubscriptionsParams {
  tenantId?: string;
  workspaceId?: string;
  planVersionId?: string;
  status?: string;
  cycleType?: string;
  page?: number;
  pageSize?: number;
}

export interface ListSubscriptionsResult {
  items: SubscriptionRecord[];
  total: number;
}

export interface CreateSubscriptionInput {
  tenantId: string;
  workspaceId: string;
  planVersionId: string;
  cycleType: string;
  /** default 1 (v1: multi-cycle bundles are not supported) */
  cycleCount?: number;
  startAt: Date;
  endAt?: Date;
  trialEndAt?: Date;
  autoRenew?: boolean;
  orderNo?: string;
  payAmount?: number;
  currency?: string;
  createdBy: string;
  /** default 'active' (product_320: offline orders create 'suspended') */
  status?: string;
  /** default 'paid' */
  subscriptionKind?: string;
  /** default 'online_purchase' */
  activationMethod?: string;
  /** default 'customer' */
  createdByType?: string;
}

export interface UpdateSubscriptionInput {
  status?: string;
  endAt?: Date;
  autoRenew?: boolean;
  toPlanVersionId?: string;
  operatorType?: string;
  operatorId?: string;
  operatorRemark?: string;
  clientIp?: string;
  updatedBy?: string;
  /**
   * Compare-and-set guard (D10 sweep): when set, the write only applies if
   * the row's CURRENT status still matches — otherwise 0 rows update (no
   * history, no hooks). Closes the check-then-act window between a sweep's
   * findLapsedTrialIds/getById read and its write, where a concurrent admin
   * action (renew/resume, which locks FOR UPDATE) could otherwise be
   * clobbered back to the sweep's stale target status.
   */
  expectedStatus?: string;
}

// ── Offline order primitives (product_320 §2) ──────────────────────────────
// A pending order IS a subscription row (status='suspended', activation_method=
// 'offline_purchase') paired 1:1 with an unpaid billing.invoices row. No 7th
// subscription status, no separate order table — see product_320 §2 O1.

export type OrderIntent = "new" | "renew" | "upgrade";

export interface CreateOfflineOrderInput {
  tenantId: string;
  workspaceId: string;
  planVersionId: string;
  /** 'month' | 'year' — must have a matching product.plan_prices row */
  cycleUnit: string;
  price: number;
  currency?: string;
  createdBy: string;
  intent: OrderIntent;
  /** required when intent='upgrade': the live subscription being upgraded */
  upgradeOfSubscriptionId?: string;
  /** billing.invoice_items.item_name, e.g. "Arda Pro" */
  itemName: string;
  /**
   * Payment window in minutes, fixed at order creation by tenant type
   * (personal 30 / organization 2880 — product_321 P4 rev. 2026-08-20).
   * Persisted to subscriptions.payment_ttl_minutes; omitted → column NULL and
   * every reader falls back to env ORDER_PAYMENT_TTL_MINUTES (legacy behavior).
   */
  paymentTtlMinutes?: number;
}

export interface OfflineOrderRecord {
  subscription: SubscriptionRecord;
  invoiceId: string;
  billNo: string;
  orderNo: string;
}

export interface ActivateOrderInput {
  /** null for system actors — actor_id is a uuid column (jobs have no uuid). */
  operatorId: string | null;
  remark?: string;
  clientIp?: string;
  /**
   * History actor (product_321 P8): 'operator' (admin confirm, default),
   * 'customer' (cashDue=0 instant settle) or 'system' (reconcile job).
   */
  actorType?: "operator" | "customer" | "system";
}

export interface CancelOfflineOrderInput {
  actorType: "customer" | "operator" | "system";
  /** null for system actors — actor_id is a uuid column (jobs have no uuid). */
  actorId: string | null;
  remark?: string;
  clientIp?: string;
  /**
   * subscription_histories.change_type for the close (product_321 P4):
   * 'cancelled' (default — customer cancel / admin void) or 'order_expired'
   * (timeout sweep), so the six-state derivation can tell them apart.
   */
  changeType?: "cancelled" | "order_expired";
}

export interface RestoreOfflineOrderInput {
  actorType: "operator" | "system";
  /** null for system actors — actor_id is a uuid column (jobs have no uuid). */
  actorId: string | null;
  remark?: string;
  clientIp?: string;
}

// ── Payment declaration (product_321 P8) ────────────────────────────────────

export type DeclarePayChannel = "alipay" | "bank_transfer";

export interface DeclarePaymentInput {
  orderId: string;
  /** Ownership is validated by the caller; used for scoping voucher reserve. */
  tenantId: string;
  userId: string;
  payChannel: DeclarePayChannel;
  discountVoucherId?: string | null;
  creditVoucherId?: string | null;
  payerName?: string;
  transactionNo?: string;
  remark?: string;
  clientIp?: string;
}

export interface DeclarePaymentResult {
  /**
   * declared            — cash leg created, awaiting admin confirm
   * already_declared    — idempotent re-submit, existing leg returned
   * activated           — cashDue=0, stage 2 succeeded (subscription live)
   * activating          — cashDue=0, funds committed but stage 2 hung; the
   *                       reconcile job / admin re-drive will finish it (P8)
   * already_settled     — invoice already cleared (hang window re-submit)
   */
  outcome:
    | "declared"
    | "already_declared"
    | "activated"
    | "activating"
    | "already_settled";
  /** Cash still due, NUMERIC(12,2) yuan string ("0.00" for cashDue=0). */
  cashDue: string;
  /** The pending_verify cash-leg payments row id (null when cashDue=0). */
  paymentId: string | null;
}
