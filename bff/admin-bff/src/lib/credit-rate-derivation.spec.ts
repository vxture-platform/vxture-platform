/**
 * credit-rate-derivation.spec.ts —— ADR-014：毛利均衡推导的核心性质。
 *
 * 最要紧的一条是**毛利收敛**：不论成本高低、不论哪一维，按 `成本÷((1−m)×锚价)` 推出的
 * 费率都应让该维毛利回到目标 m（取整后在千分之几以内）。另外钉住十进制解析与单位换算
 * 不走 float、缓存维未声明时回落 input。
 */
import { describe, expect, it } from "vitest";
import {
  decimalCnyToMicro,
  deriveFourDimRate,
  deriveRateMicroPer1k,
  vendorCostMicroCnyPer1k,
  type PricingConfig,
} from "./credit-rate-derivation";

const CFG: PricingConfig = {
  anchorMicroCnyPerCredit: 200_000n, // ¥0.20 / credit
  targetMarginBps: 7000, // 70%
};

/** 用推导出的费率反算该维毛利：收费 = 费率/1e6 × 锚价(micro-CNY)；毛利 = (收费−成本)/收费。 */
function realizedMargin(costMicroCnyPer1k: bigint, cfg: PricingConfig): number {
  const rate = deriveRateMicroPer1k(costMicroCnyPer1k, cfg);
  const revenueMicroCny =
    (Number(rate) / 1_000_000) * Number(cfg.anchorMicroCnyPerCredit);
  const cost = Number(costMicroCnyPer1k);
  return (revenueMicroCny - cost) / revenueMicroCny;
}

describe("decimalCnyToMicro", () => {
  it("整数与小数都转对，8 位小数四舍五入到 micro", () => {
    expect(decimalCnyToMicro("0")).toBe(0n);
    expect(decimalCnyToMicro("1")).toBe(1_000_000n);
    expect(decimalCnyToMicro("0.20")).toBe(200_000n);
    expect(decimalCnyToMicro("0.000001")).toBe(1n);
    expect(decimalCnyToMicro("0.0000005")).toBe(1n); // 第7位 5 → 进位
    expect(decimalCnyToMicro("0.0000004")).toBe(0n); // 第7位 4 → 舍
    expect(decimalCnyToMicro("2.50000000")).toBe(2_500_000n);
  });
  it("非法格式抛错", () => {
    expect(() => decimalCnyToMicro("-1")).toThrow();
    expect(() => decimalCnyToMicro("abc")).toThrow();
    expect(() => decimalCnyToMicro("")).toThrow();
  });
});

describe("vendorCostMicroCnyPer1k", () => {
  it("单价 ¥8/1M tokens → 每 1K token 成本 = 8000 micro-CNY（¥0.008）", () => {
    // ¥8 = 8_000_000 micro; ×1000 ÷ 1_000_000 = 8000 micro-CNY / 1K
    expect(vendorCostMicroCnyPer1k("8", 1_000_000)).toBe(8000n);
  });
  it("单价 ¥2/1M → 2000 micro-CNY/1K", () => {
    expect(vendorCostMicroCnyPer1k("2", 1_000_000)).toBe(2000n);
  });
  it("unitTokens 非正抛错", () => {
    expect(() => vendorCostMicroCnyPer1k("1", 0)).toThrow();
  });
});

describe("deriveRateMicroPer1k —— 毛利收敛", () => {
  // 覆盖便宜/中端/高端/超高端，进出两类（成本以 micro-CNY/1K 给）。
  // 真实量级（micro-CNY/1K）：便宜 ~2000、中端 ~8000、高端 ~40000-80000、超高端 ~242000+。
  // 不测 micro 级的退化成本——那一档整取整误差盖过毛利，而现实里没有那么便宜的模型。
  const costs = [200n, 2000n, 8000n, 40000n, 80000n, 242000n, 550000n];
  for (const cost of costs) {
    it(`成本 ${cost} micro-CNY/1K → 毛利回到 70%（±0.2%）`, () => {
      const m = realizedMargin(cost, CFG);
      expect(Math.abs(m - 0.7)).toBeLessThan(0.002);
    });
  }

  it("不同目标毛利都收敛（60% / 75%）", () => {
    expect(
      Math.abs(realizedMargin(8000n, { ...CFG, targetMarginBps: 6000 }) - 0.6),
    ).toBeLessThan(0.002);
    expect(
      Math.abs(realizedMargin(8000n, { ...CFG, targetMarginBps: 7500 }) - 0.75),
    ).toBeLessThan(0.002);
  });

  it("70% + ¥0.20 锚价下，成本 ¥0.008/1K（8000 micro）→ 约 1.333 credit/1K", () => {
    // 8000 ×1e6 ×10000 ÷ (200000 × 3000) = 8e13 / 6e8 = 133333.33 → 133333
    expect(deriveRateMicroPer1k(8000n, CFG)).toBe(133_333n);
  });

  it("锚价 ≤0 或 bps 越界抛错", () => {
    expect(() =>
      deriveRateMicroPer1k(8000n, { ...CFG, anchorMicroCnyPerCredit: 0n }),
    ).toThrow();
    expect(() =>
      deriveRateMicroPer1k(8000n, { ...CFG, targetMarginBps: 10000 }),
    ).toThrow();
    expect(() =>
      deriveRateMicroPer1k(8000n, { ...CFG, targetMarginBps: -1 }),
    ).toThrow();
  });
});

describe("deriveFourDimRate", () => {
  it("四维各自推导；缓存读/写未声明回落 input 价", () => {
    const r = deriveFourDimRate(
      {
        unitTokens: 1_000_000,
        inputUnitPrice: "2", // ¥2/1M → 2000 micro/1K → rate 33333
        outputUnitPrice: "8", // ¥8/1M → 8000 → 133333
        cachedInputUnitPrice: null, // 回落 input
        cacheWriteUnitPrice: null, // 回落 input
      },
      CFG,
    );
    expect(r.inputMicroPer1k).toBe("33333");
    expect(r.outputMicroPer1k).toBe("133333");
    expect(r.cacheReadMicroPer1k).toBe("33333"); // = input
    expect(r.cacheWriteMicroPer1k).toBe("33333"); // = input
  });

  it("声明了缓存读价就用它（便宜很多）", () => {
    const r = deriveFourDimRate(
      {
        unitTokens: 1_000_000,
        inputUnitPrice: "2",
        outputUnitPrice: "8",
        cachedInputUnitPrice: "0.2", // ¥0.2/1M → 200 micro/1K → rate 3333
        cacheWriteUnitPrice: "2.5",
      },
      CFG,
    );
    expect(r.cacheReadMicroPer1k).toBe("3333");
    expect(Number(r.cacheWriteMicroPer1k)).toBeGreaterThan(
      Number(r.inputMicroPer1k),
    );
  });
});
