/**
 * wallet-money.spec.ts - Exact cents and storage-boundary tests.
 * @package @vxture/service-billing
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, expect, it } from "vitest";
import { walletAmount, walletCents, positiveWalletCents } from "./wallet-money";
describe("wallet exact money", () => {
  it.each([0, 1, 29, 101, -1, -29, 999_999_999_999, -999_999_999_999])(
    "round trips %s cents without floating loss",
    (value) => {
      expect(walletCents(walletAmount(value))).toBe(value);
    },
  );
  it.each(["1.001", "1e2", "NaN", " 1.00", "10000000000.00", "", "+1.00"])(
    "rejects ambiguous decimal %s",
    (value) => {
      expect(() => walletCents(value)).toThrow();
    },
  );
  it.each([
    0,
    -1,
    0.1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1_000_000_000_000,
  ])("rejects invalid command amount %s", (value) => {
    expect(() => positiveWalletCents(value)).toThrow();
  });
});
