import { describe, expect, it } from "vitest";
import {
  usagePeriodKeys,
  usageWindowStart,
  zeroFillBuckets,
} from "./usage-periods";

/**
 * 周期键全程 UTC、末桶 = 当前周期、缺桶补零——这三条是「近 7 天」不再变成
 * 「最后 7 个有数据的桶」的全部依据(console 批 3 / 审计 P0 #8)。
 */
describe("usagePeriodKeys", () => {
  // 2026-09-04T01:30Z 是周五;本地时区无论是什么,键都按 UTC 算。
  const now = new Date("2026-09-04T01:30:00Z");

  it("day:span 个自然日(UTC),末项 = 今天", () => {
    expect(usagePeriodKeys("day", 3, now)).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
  });

  it("hour:逐时,跨日也按 UTC 日期带全", () => {
    expect(usagePeriodKeys("hour", 3, now)).toEqual([
      "2026-09-03 23:00",
      "2026-09-04 00:00",
      "2026-09-04 01:00",
    ]);
  });

  it("week:ISO 周一;周日归上一周", () => {
    expect(usagePeriodKeys("week", 2, now)).toEqual([
      "2026-08-24",
      "2026-08-31",
    ]);
    const sunday = new Date("2026-09-06T12:00:00Z");
    expect(usagePeriodKeys("week", 1, sunday)).toEqual(["2026-08-31"]);
  });

  it("month / year:跨年回绕", () => {
    const jan = new Date("2026-01-15T00:00:00Z");
    expect(usagePeriodKeys("month", 3, jan)).toEqual([
      "202511",
      "202512",
      "202601",
    ]);
    expect(usagePeriodKeys("year", 2, jan)).toEqual(["2025", "2026"]);
  });

  it("窗口起点:hour 给 ISO 时刻,其余给键本身", () => {
    expect(usageWindowStart("hour", "2026-09-03 23:00")).toBe(
      "2026-09-03T23:00:00Z",
    );
    expect(usageWindowStart("day", "2026-09-02")).toBe("2026-09-02");
    expect(usageWindowStart("month", "202511")).toBe("202511");
  });
});

describe("zeroFillBuckets", () => {
  it("每个键都有一桶;稀疏行归位、键外行丢弃", () => {
    const keys = ["2026-09-02", "2026-09-03", "2026-09-04"];
    const buckets = zeroFillBuckets(keys, [
      { period: "2026-09-04", productCode: "a", productName: "A", total: 5 },
      { period: "2026-09-04", productCode: "b", productName: "B", total: 2 },
      { period: "2026-09-02", productCode: "a", productName: "A", total: 1 },
      { period: "2026-08-01", productCode: "a", productName: "A", total: 99 },
    ]);
    expect(buckets.map((b) => b.period)).toEqual(keys);
    expect(buckets.map((b) => b.total)).toEqual([1, 0, 7]);
    expect(buckets[2]!.byProduct).toHaveLength(2);
    expect(buckets[1]!.byProduct).toEqual([]);
  });
});
