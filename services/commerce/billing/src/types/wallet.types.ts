/**
 * wallet.types.ts - Trusted application commands and source-preserving receipts.
 * @package @vxture/service-billing
 * @layer Domain
 * @category types
 * @author AI-Generated
 * @date 2026-11-19
 */
export interface WalletContext {
  tenantId: string;
  currency: string;
  actorType: "customer" | "operator" | "system";
  actorId: string;
}
export type WalletCommand = { idempotencyKey: string; invoiceId?: string } & (
  | {
      action: "principal";
      amountCents: number;
      paymentId: string;
      cardAllocationId?: string;
    }
  | { action: "bonus"; amountCents: number; expiresAt?: string }
  | { action: "consume"; amountCents: number }
  | { action: "restore"; amountCents: number; consumptionId: string }
  | { action: "expire" }
  | { action: "reclaim"; lotId: string; amountCents?: number }
);
export interface WalletResult {
  operationId: string;
  transactionId: string;
  action: WalletCommand["action"];
  amount: string;
  balance: string;
  restoredAmount: string;
  expiredAmount: string;
  lotId: string | null;
}
export interface WalletSummary {
  status: "absent" | "unverified" | "ready" | "inconsistent";
  currency: string;
  balance: string;
  principalBalance: string | null;
  bonusBalance: string | null;
  availableBalance: string | null;
  expiredBonusBalance: string | null;
}

// ===========================================================================
// Audit projections never expose card credentials or payment account details.
// ===========================================================================
export interface WalletHistoryRecord {
  operationId: string;
  action: WalletCommand["action"];
  transactionNo: string;
  createdAt: string;
  result: WalletResult;
  entries: {
    id: string;
    lotId: string;
    kind: "principal" | "bonus";
    type: "credit" | "consume" | "restore" | "expire" | "reclaim";
    amount: string;
    debitEntryId: string | null;
    paymentNo: string | null;
    expiresAt: string | null;
  }[];
}
export interface WalletHistoryPage {
  total: number;
  page: number;
  pageSize: number;
  items: WalletHistoryRecord[];
}
