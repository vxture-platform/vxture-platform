import { describe, expect, it } from "vitest";
import {
  computeProration,
  computeWindowRefund,
  cycleDays,
  daysLeftOf,
} from "./proration";

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

/*
 * 折算退（owner 2026-09-25：「考虑配额消耗，后续再补充再 24H 内，也需要折算，我们有成本」）。
 * 下面这张表就是定稿文档里那张算例表，一行一条断言——文档与代码不许各说一套。
 */
describe("computeWindowRefund：24 小时窗口内的折算退", () => {
  it.each([
    // α,   已用,  实付,   退客户, 平台留
    [0, 0, 100, 100, 0], // 无消耗性池：零成本，全额退（与今天一致）
    [0.5, 0, 100, 100, 0], // 开通了没用
    [0.5, 0.1, 100, 95, 5], // 今天这一档一分不退，实际成本只有 5 元
    [0.5, 0.6, 100, 70, 30], // owner 说的「我们有成本」那一档
    [0.5, 1, 100, 50, 50], // 配额用光仍退一半：另一半价钱不在配额上
    [1, 1, 100, 0, 100], // 价值全在配额里的产品，用光就不退
    [0.5, 0.6, 0.1, 0.07, 0.03], // 小额仍走 round2
  ])(
    "α=%s 已用=%s 实付=%s → 退 %s / 留 %s",
    (alpha, usedRatio, paid, amount, kept) => {
      const r = computeWindowRefund({ paid, alpha, usedRatio });
      expect(r.amount).toBe(amount);
      expect(r.kept).toBe(kept);
    },
  );

  it("窗口内不按天扣——时间那一份整份退回（否则 2 小时就退只退 96.7%）", () => {
    // 与 computeProration 的对照：同 α、同 u，但那边 r=29/30，这边 r=1。
    const byFormula = computeProration({
      pOld: 100,
      pNew: 0,
      daysTotal: 30,
      daysLeft: 29,
      usageRemainingRatio: 1,
      consumableShare: 0.5,
    });
    expect(byFormula.credit).toBe(98.33); // = 100 × (0.5×29/30 + 0.5×1)
    const byWindow = computeWindowRefund({
      paid: 100,
      alpha: 0.5,
      usedRatio: 0,
    });
    expect(byWindow.amount).toBe(100);
  });

  it("full 标志决定 refund_type（全额 normal / 少于实付 partial）", () => {
    expect(
      computeWindowRefund({ paid: 100, alpha: 0.5, usedRatio: 0 }).full,
    ).toBe(true);
    expect(
      computeWindowRefund({ paid: 100, alpha: 0.5, usedRatio: 0.6 }).full,
    ).toBe(false);
  });

  it("入参越界一律夹住，不靠调用方保证", () => {
    const r = computeWindowRefund({ paid: -5, alpha: 9, usedRatio: 9 });
    expect(r.paid).toBe(0);
    expect(r.alpha).toBe(1);
    expect(r.usedRatio).toBe(1);
    expect(r.amount).toBe(0);
  });
});
