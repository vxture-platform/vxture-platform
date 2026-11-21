// Settlement money math (product_321 §5.3). Single source of truth shared by
// quote, declare, release-recompute and the payment-page breakdown — the same
// numbers must come out wherever they are computed. Pure functions, integer
// cents only; fractional input is a caller bug and throws.

import type { DiscountEffect } from "../types/promotion.types";

const assertCents = (label: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} 必须是非负整数分: ${value}`);
  }
};

/** NUMERIC(12,2) yuan string (DB edge) -> integer cents. */
export const yuanToCents = (value: string | number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`非法金额: ${value}`);
  return Math.round(n * 100);
};

/** Integer cents -> NUMERIC(12,2) yuan string for SQL params. */
export const centsToYuan = (cents: number): string => {
  assertCents("cents", cents);
  return (cents / 100).toFixed(2);
};

/**
 * Discount reduction, cents. percent floors to the cent (向下取整到分),
 * fixed is the face value; both are capped by max_off_cents and list price.
 */
export const computeDiscountOffCents = (
  listPriceCents: number,
  effect: DiscountEffect,
): number => {
  assertCents("listPriceCents", listPriceCents);
  let off: number;
  if (effect.discountType === "percent") {
    if (effect.value < 0 || effect.value > 100) {
      throw new Error(`percent 折扣值域 0-100: ${effect.value}`);
    }
    off = Math.floor((listPriceCents * effect.value) / 100);
  } else {
    assertCents("fixed discount value", effect.value);
    off = effect.value;
  }
  if (effect.maxOffCents != null) off = Math.min(off, effect.maxOffCents);
  return Math.min(off, listPriceCents);
};

export interface SettlementInput {
  listPriceCents: number;
  /** invoice.paid_amount at quote time, cents (legacy partial orders, P5). */
  paidCents: number;
  discountEffect?: DiscountEffect | null;
  creditVoucherCents?: number | null;
}

export interface SettlementQuote {
  listPriceCents: number;
  discountOffCents: number;
  payableCents: number;
  paidCents: number;
  voucherOffCents: number;
  cashDueCents: number;
  /**
   * False when the discounted payable would drop below the amount already
   * collected (P5 partial-order anchor rule) — the discount voucher must be
   * treated as unusable; the returned figures exclude it.
   */
  discountApplicable: boolean;
}

/**
 * P5 settlement chain, fixed order: list − discount = payable;
 * voucherOff caps at the outstanding balance (payable − paid), never at
 * payable itself; cashDue floors at zero.
 */
export const computeSettlement = (input: SettlementInput): SettlementQuote => {
  assertCents("listPriceCents", input.listPriceCents);
  assertCents("paidCents", input.paidCents);
  if (input.creditVoucherCents != null) {
    assertCents("creditVoucherCents", input.creditVoucherCents);
  }

  let discountOff = input.discountEffect
    ? computeDiscountOffCents(input.listPriceCents, input.discountEffect)
    : 0;
  let payable = input.listPriceCents - discountOff;
  let discountApplicable = true;

  if (input.discountEffect && payable < input.paidCents) {
    // Discounted payable below collected money -> voucher unusable (P5).
    discountApplicable = false;
    discountOff = 0;
    payable = input.listPriceCents;
  }

  const outstanding = Math.max(0, payable - input.paidCents);
  const voucherOff = Math.min(input.creditVoucherCents ?? 0, outstanding);
  const cashDue = Math.max(0, outstanding - voucherOff);

  return {
    listPriceCents: input.listPriceCents,
    discountOffCents: discountOff,
    payableCents: payable,
    paidCents: input.paidCents,
    voucherOffCents: voucherOff,
    cashDueCents: cashDue,
    discountApplicable,
  };
};

/**
 * Parse + validate a discount effect JSONB (batch config, snake_case keys).
 * Range checks live HERE so a dirty batch config surfaces as "voucher
 * unusable" (filtered/null) instead of a 500 at quote time.
 */
export const parseDiscountEffect = (
  effect: Record<string, unknown>,
): DiscountEffect | null => {
  const type = effect["discount_type"];
  const value = effect["value"];
  if (
    (type !== "percent" && type !== "fixed") ||
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return null;
  }
  if (type === "percent" && (value < 0 || value > 100)) return null;
  if (type === "fixed" && (!Number.isSafeInteger(value) || value < 0)) {
    return null;
  }
  const maxOff = effect["max_off_cents"];
  if (
    maxOff != null &&
    (!Number.isSafeInteger(maxOff) || (maxOff as number) < 0)
  ) {
    return null;
  }
  return {
    discountType: type,
    value,
    maxOffCents: typeof maxOff === "number" ? maxOff : null,
  };
};

/** Parse + validate a credit voucher effect JSONB. */
export const parseCreditVoucherEffect = (
  effect: Record<string, unknown>,
): { amountCents: number } | null => {
  const amount = effect["amount_cents"];
  if (!Number.isSafeInteger(amount) || (amount as number) <= 0) return null;
  return { amountCents: amount as number };
};
