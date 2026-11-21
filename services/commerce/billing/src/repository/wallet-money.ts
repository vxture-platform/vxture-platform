/**
 * wallet-money.ts - Exact NUMERIC(12,2) conversions without floating arithmetic.
 * @package @vxture/service-billing
 * @layer Domain
 * @category money
 * @author AI-Generated
 * @date 2026-11-19
 */
import { BadRequestException } from "@nestjs/common";
const MAX_CENTS = 999_999_999_999;
/** Parse a database decimal. @param value - Exact amount string. @returns Integer cents. @throws {BadRequestException} For invalid or overflowing money. */
export function walletCents(value: string): number {
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(value))
    throw new BadRequestException("钱包金额格式非法");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const amount = Number(
    BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0")),
  );
  if (amount > MAX_CENTS) throw new BadRequestException("钱包金额超出上限");
  return negative ? -amount : amount;
}
/** Validate bounded cents. @param value - Command amount. @returns Original amount. @throws {BadRequestException} For nonpositive or overflowing money. */
export function positiveWalletCents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CENTS)
    throw new BadRequestException("金额必须为有效的正整数分");
  return value;
}
/** Format exact cents. @param cents - Signed integer cents. @returns Two-decimal amount. @throws {BadRequestException} For overflow. */
export function walletAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS)
    throw new BadRequestException("钱包金额超出上限");
  const n = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}
