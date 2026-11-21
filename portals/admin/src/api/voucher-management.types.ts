/**
 * voucher-management.types.ts - Operator voucher management HTTP contracts.
 * @package @vxture/admin
 * @layer Presentation
 * @category types
 * @author AI-Generated
 * @date 2026-11-20
 */
// ===========================================================================
// Commands
// ===========================================================================
export interface VoucherBatchConfiguration {
  kind:
    | "discount"
    | "credit_voucher"
    | "invite"
    | "redemption"
    | "extension"
    | "recharge_card";
  name: string;
  effect: Record<string, unknown>;
  totalCount: number;
  codePrefix?: string;
  tenantId?: string | null;
  perUserLimit?: number;
  perWorkspaceLimit?: number | null;
  perTenantLimit?: number | null;
  validFrom: string;
  validUntil: string;
  claimUntil?: string | null;
  useValidDays?: number | null;
  returnPolicy?: "none" | "full_reversal_only";
}
export interface VoucherOperatorCommand {
  idempotencyKey: string;
  reason: string;
}
export type VoucherBatchAction = VoucherOperatorCommand &
  (
    | { action: "review"; expectedRevision: string }
    | { action: "pause" | "resume" | "archive" }
    | { action: "configure"; configuration: VoucherBatchConfiguration }
    | { action: "request_budget"; totalCount: number }
    | { action: "approve_budget"; requestOperationId: string }
  );
// ===========================================================================
// Read models
// ===========================================================================
export interface VoucherBatchDetail extends Omit<
  VoucherBatchConfiguration,
  "kind" | "codePrefix"
> {
  id: string;
  revision: string;
  kind: string;
  codePrefix: string | null;
  status: "draft" | "active" | "paused" | "archived";
  issuedCount: number;
  claimedCount: number;
  reservedCount: number;
  redeemedCount: number;
  expiredCount: number;
  revokedCount: number;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  frozenAt: string | null;
  compensationBatch: boolean;
  pendingBudgetRequests: Array<{
    id: string;
    requestedBy: string;
    totalCount: number;
    reason: string;
  }>;
}
export interface VoucherInstance {
  id: string;
  code: string;
  status: string;
  tenantId: string | null;
  workspaceId: string | null;
  userId: string | null;
  claimedAt: string | null;
  expiresAt: string;
  reservedOrderId: string | null;
  redeemedOrderId: string | null;
  redemptionNo: string | null;
  paymentId: string | null;
  invoiceItemId: string | null;
  subscriptionId: string | null;
  walletTransactions: string[];
  fundingPaymentNo: string | null;
  fundingStatus: string | null;
}
export interface VoucherAuditEvent {
  id: string;
  eventType: string;
  actorRealm: string;
  actorId: string;
  actorName: string;
  reason: string | null;
  createdAt: string;
  voucherId: string | null;
  orderId: string | null;
  operationId: string;
  operationType: string;
  metadata: Record<string, unknown>;
}
export interface VoucherPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
