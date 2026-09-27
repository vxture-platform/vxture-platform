export enum BillingCycle {
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  ANNUAL = "annual",
  YEARLY = "yearly",
}

/**
 * Enum form of @vxture-platform/shared SUBSCRIPTION_STATUSES (needed by class-validator
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
  payAmount?: number;
  currency?: string;
  createdBy: string;
  /** default 'active' */
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

// ── 暂停 episode（metering.subscription_suspensions）────────────────────────
// 运营对单条订阅的暂停 / 恢复走 admin-bff 的裸 SQL 事务（subscriptions.router 的
// SUSPENSION_OPEN_SQL）；这里是服务侧写入方的契约——产品级维护窗口的批量暂停
// （2026-09-27）由 platform-api 作业经本服务开 episode。

/** 开一条暂停 episode。镜像 admin-bff SUSPENSION_OPEN_SQL 的列，外加窗口归属。 */
export interface OpenSuspensionInput {
  subscriptionId: string;
  tenantId: string;
  /** @shared SUSPENSION_REASONS 之一；顺不顺延由它派生但**落库**（extendsTerm）。 */
  reason: string;
  reasonNote?: string | null;
  extendsTerm: boolean;
  /** 暂停那一刻的 auto_renew，恢复时还原；不知道就 null（= 恢复时不动）。 */
  autoRenewBefore: boolean | null;
  expectedResumeAt: Date | null;
  actorType: "system" | "customer" | "operator";
  actorId?: string | null;
  clientIp?: string | null;
  /** 产品级维护窗口批量开的 episode 带窗口 id；个例暂停为 null。 */
  maintenanceWindowId?: string | null;
}

/** 进窗口候选：产品打着窗口、订阅在服务中、没有未闭合 episode。 */
export interface MaintenanceCandidate {
  subscriptionId: string;
  tenantId: string;
  /** 扫到时的状态，给 CAS 用（expectedStatus）。 */
  status: string;
  autoRenew: boolean;
  productId: string;
  maintenanceWindowId: string;
  /** 产品上的 maintenance_until = 这次暂停的预计恢复时间。 */
  maintenanceUntil: Date;
}

/** 出窗口候选：未闭合 episode 带窗口 id，而产品上已不再打着同一个窗口 id。 */
export interface MaintenanceRelease {
  /** episode id */
  id: string;
  subscriptionId: string;
  /** 扫到时的订阅状态（谓词已限定 suspended，带出来给服务层复核）。 */
  status: string;
  autoRenewBefore: boolean | null;
  maintenanceWindowId: string;
}

// ── Payment declaration (product_321 P8) ────────────────────────────────────
// Orders live in billing.orders (product_330); the declare orchestration is
// OrderService.declarePayment. These types are the shared contract for it.

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
