import { describe, expect, it } from "vitest";
import { computeProration, cycleDays, daysLeftOf } from "./proration";

// product_330 §4.1 / owner 决策 2：credit = P_old × ((1−α)·r + α·u)，
// payable = max(0, P_new − credit)，leftover = max(0, credit − P_new)。

describe("computeProration", () => {
  it("free → paid: P_old = 0 gives no credit, full price payable", () => {
    const p = computeProration({
      pOld: 0,
      pNew: 1200,
      daysTotal: 30,
      daysLeft: 20,
      usageRemainingRatio: 0.9,
      consumableShare: 0.5,
    });
    expect(p.credit).toBe(0);
    expect(p.payable).toBe(1200);
    expect(p.leftover).toBe(0);
  });

  it("weights time and usage by α (owner example: half time left, 80% credits left, α=0.5)", () => {
    const p = computeProration({
      pOld: 100,
      pNew: 300,
      daysTotal: 30,
      daysLeft: 15,
      usageRemainingRatio: 0.8,
      consumableShare: 0.5,
    });
    // (1−0.5)·0.5 + 0.5·0.8 = 0.25 + 0.4 = 0.65 → 65.00
    expect(p.creditTime).toBe(25);
    expect(p.creditUsage).toBe(40);
    expect(p.credit).toBe(65);
    expect(p.payable).toBe(235);
    expect(p.leftover).toBe(0);
  });

  it("no consumable pools: α collapses to 0, credit is purely time-based", () => {
    const p = computeProration({
      pOld: 120,
      pNew: 240,
      daysTotal: 365,
      daysLeft: 73,
      usageRemainingRatio: null,
      consumableShare: 0.5,
    });
    expect(p.alpha).toBe(0);
    expect(p.credit).toBe(24); // 120 × 0.2
    expect(p.payable).toBe(216);
  });

  it("credit larger than the new price: payable 0, leftover goes to prepaid balance", () => {
    const p = computeProration({
      pOld: 1000,
      pNew: 100,
      daysTotal: 365,
      daysLeft: 365,
      usageRemainingRatio: 1,
      consumableShare: 0.5,
    });
    expect(p.credit).toBe(1000);
    expect(p.payable).toBe(0);
    expect(p.leftover).toBe(900);
  });

  it("clamps: negative/over-range days and ratios never inflate the credit beyond P_old", () => {
    const p = computeProration({
      pOld: 50,
      pNew: 80,
      daysTotal: 10,
      daysLeft: 99,
      usageRemainingRatio: 7,
      consumableShare: 3,
    });
    expect(p.r).toBe(1);
    expect(p.u).toBe(1);
    expect(p.alpha).toBe(1);
    expect(p.credit).toBe(50);
  });

  it("money stays at two decimals", () => {
    const p = computeProration({
      pOld: 0.1,
      pNew: 0.1,
      daysTotal: 365,
      daysLeft: 200,
      usageRemainingRatio: 0.3333,
      consumableShare: 0.5,
    });
    expect(p.credit).toBe(0.04); // 0.1 × (0.5·0.5479 + 0.5·0.3333) = 0.044 → 0.04
    expect(p.payable).toBe(0.06);
  });
});

describe("cycle day helpers", () => {
  it("cycleDays rounds up and floors at 1; daysLeftOf floors and never goes negative", () => {
    const start = new Date("2026-09-03T00:00:00Z");
    expect(cycleDays(start, new Date("2027-09-03T00:00:00Z"))).toBe(365);
    expect(cycleDays(start, new Date("2026-09-03T01:00:00Z"))).toBe(1);
    expect(cycleDays(start, start)).toBe(1);
    expect(
      daysLeftOf(
        new Date("2026-09-10T12:00:00Z"),
        new Date("2026-09-03T00:00:00Z"),
      ),
    ).toBe(7);
    expect(daysLeftOf(start, new Date("2026-10-01T00:00:00Z"))).toBe(0);
  });
});
