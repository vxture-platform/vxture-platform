// Voucher settlement types (product_321 P5/P7). V1 enables two kinds only:
// discount (pricing layer, negative invoice item) and credit_voucher
// (settlement leg, payments row pay_source='voucher'). All amounts in the
// effect JSONB are integer cents (data_commerce_230 §4); ledger writes convert
// to NUMERIC(12,2) yuan at the edge.

export type VoucherKind =
  | "credit_voucher"
  | "recharge_card"
  | "redemption"
  | "discount"
  | "extension";

/** Kinds the V1 settlement engine accepts. */
export type SettlementVoucherKind = "discount" | "credit_voucher";

export interface DiscountEffect {
  discountType: "percent" | "fixed";
  /** percent: 0-100 (percentage OFF); fixed: cents off. */
  value: number;
  /** Cap on the computed reduction, cents. Null = uncapped. */
  maxOffCents: number | null;
}

export interface CreditVoucherEffect {
  amountCents: number;
}

/** Ownership scope of the order doing the settlement (P7 predicate inputs). */
export interface VoucherScope {
  tenantId: string;
  workspaceId: string;
  userId: string;
}

export interface AvailableVoucher {
  voucherId: string;
  code: string;
  kind: SettlementVoucherKind;
  batchName: string;
  effect: DiscountEffect | CreditVoucherEffect;
  /** Effective expiry shown to the customer: min(batch.valid_until, voucher.expires_at). */
  expiresAt: Date;
}

export interface ReserveVouchersInput {
  scope: VoucherScope;
  discountVoucherId?: string | null;
  creditVoucherId?: string | null;
}

export interface ReservedVoucher {
  voucherId: string;
  kind: SettlementVoucherKind;
  effect: DiscountEffect | CreditVoucherEffect;
  /** Raw batch effect at reserve time — becomes effect_snapshot at finalize. */
  effectSnapshot: Record<string, unknown>;
}

export interface FinalizeVoucherInput {
  voucherId: string;
  kind: SettlementVoucherKind;
  scope: VoucherScope;
  effectSnapshot: Record<string, unknown>;
  /** discount: the negative invoice item written by the declare transaction. */
  invoiceItemId?: string | null;
  /** credit_voucher: the settlement-leg payments row. */
  paymentId?: string | null;
}

export interface ReleaseCredential {
  discountVoucherId?: string | null;
  creditVoucherId?: string | null;
}

/**
 * 「我的卡券」行(owner 2026-08-21 P0):全 kind、全状态的租户视角台账。
 * 展示态由读侧派生——库里没有主动置 expired 的清扫(到期只靠谓词过滤),
 * 所以过期必须按时间算,不能只看 status。
 */
export interface TenantVoucherRecord {
  voucherId: string;
  code: string;
  kind: VoucherKind;
  batchName: string;
  /** 批次 effect 原文(kind 专属;金额一律整数分,展示端换算)。 */
  effect: Record<string, unknown>;
  /** 库内原始状态(assigned/reserved/redeemed/expired/revoked)。 */
  status: string;
  /** 展示派生态。 */
  displayStatus: "available" | "reserved" | "redeemed" | "expired" | "revoked";
  usedCount: number;
  maxUses: number;
  validFrom: Date;
  /** 有效期至 = min(voucher.expires_at, batch.valid_until)。 */
  expiresAt: Date;
  redeemedAt: Date | null;
  /** 最近一次核销的对外编号(redemptions)。 */
  redemptionNo: string | null;
}
