/**
 * refund-sources.spec.ts - Cash isolation and deterministic refund rounding.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, expect, it } from "vitest";
import {
  allocateCashRefund,
  allocateRefundSources,
  type RefundSource,
} from "./refund-sources";
// ============================================================================
// Policy preserves source kinds; cash transfer accepts only external receipts.
// ============================================================================
describe("refund source allocation", () => {
  const cashSource = {
    id: "cash",
    source: "offline" as const,
    cents: 86000,
    currency: "CNY",
  };
  const sources = [
    cashSource,
    {
      id: "voucher",
      source: "voucher" as const,
      cents: 10000,
      currency: "CNY",
    },
  ];
  it("returns cash 774 and voucher value 90 from the mixed-payment policy example", () => {
    expect(
      allocateRefundSources(sources, 0.5, 0.2).map((s) => s.targetCents),
    ).toEqual([77400, 9000]);
    expect(() =>
      allocateCashRefund(
        sources.filter((s) => s.source !== "voucher"),
        96000,
      ),
    ).toThrow();
  });
  it("uses UUID order to allocate half-cent ties independently of input order", () => {
    const small = sources.map((s, i) => ({
      ...s,
      id: String(2 - i),
      cents: 1,
    }));
    expect(
      allocateRefundSources(small, 1, 0.5).find((s) => s.id === "1")
        ?.targetCents,
    ).toBe(1);
    expect(
      allocateRefundSources([...small].reverse(), 1, 0.5).find(
        (s) => s.id === "1",
      )?.targetCents,
    ).toBe(1);
  });
  it.each([NaN, Infinity, -0.1, 1.1])("rejects invalid policy %s", (value) =>
    expect(() => allocateRefundSources(sources, value, 0.1)).toThrow(),
  );
  it("preserves sum and original caps across varied costs", () => {
    for (let i = 0; i <= 100; i++) {
      const rows = allocateRefundSources(sources, 1, i / 100);
      expect(rows.reduce((n, s) => n + s.targetCents, 0)).toBe(
        Math.round(96000 * (1 - i / 100)),
      );
      expect(
        rows.every((s) => s.targetCents >= 0 && s.targetCents <= s.cents),
      ).toBe(true);
    }
  });

  // External persisted values must be checked even when callers assert a TS type.
  it.each(["unknown", "", null])(
    "rejects persisted non-cash source %s in policy and cash allocation",
    (source) => {
      const legacy = [{ ...cashSource, source }] as unknown as RefundSource[];
      expect(() => allocateRefundSources(legacy, 0.5, 0.2)).toThrow();
      expect(() => allocateCashRefund(legacy, 100)).toThrow();
      expect(() => allocateCashRefund([cashSource, ...legacy], 100)).toThrow();
    },
  );
  it("allocates proven balance value while excluding it from cash transfers", () => {
    const wallet = [{ ...cashSource, source: "balance" as const }];
    expect(allocateRefundSources(wallet, 0.5, 0.2)[0]?.targetCents).toBe(77400);
    expect(() => allocateCashRefund(wallet, 1)).toThrow();
  });
  it.each(["online", "offline"] as const)(
    "accepts proven %s cash receipts",
    (source) => {
      const cash = [{ ...cashSource, source }];
      expect(allocateCashRefund(cash, 100)[0]?.targetCents).toBe(100);
    },
  );
  it.each([NaN, Infinity, -1, 0.5])(
    "rejects invalid cash source cents %s",
    (cents) => {
      expect(() => allocateCashRefund([{ ...cashSource, cents }], 1)).toThrow();
    },
  );
});
