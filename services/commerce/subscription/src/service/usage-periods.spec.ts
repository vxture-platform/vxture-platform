import { describe, expect, it } from "vitest";
import {
  REBUCKET_HORIZON_DAYS,
  usagePeriodKeys,
  usageWindowEndExclusive,
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

/**
 * 裁定 4(2026-10-04):day 档的「今天」按用户时区算。同一瞬时在上海已是次日、
 * 在纽约仍是当日;DST 切换日在键序列里只是普通的一天。zone 省略 / 'UTC' 时与
 * 原断言逐条相同——那是回归锁,别的档位不看 zone。
 */
describe("usagePeriodKeys · day 档按用户时区", () => {
  it("上海:2026-09-04T01:30Z 仍是 09-04,三天键与 UTC 相同", () => {
    const now = new Date("2026-09-04T01:30:00Z");
    expect(usagePeriodKeys("day", 3, now, "Asia/Shanghai")).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
  });

  it("上海:2026-09-03T17:00Z 已是 09-04,而 UTC 给 09-03", () => {
    const now = new Date("2026-09-03T17:00:00Z");
    expect(usagePeriodKeys("day", 1, now, "Asia/Shanghai")).toEqual([
      "2026-09-04",
    ]);
    expect(usagePeriodKeys("day", 1, now)).toEqual(["2026-09-03"]);
    expect(usagePeriodKeys("day", 1, now, "UTC")).toEqual(["2026-09-03"]);
  });

  it("纽约:2026-09-04T01:30Z 还是 09-03", () => {
    const now = new Date("2026-09-04T01:30:00Z");
    expect(usagePeriodKeys("day", 1, now, "America/New_York")).toEqual([
      "2026-09-03",
    ]);
  });

  it("DST:柏林 2026-10-26T12:00Z 向前三天跨过 10-25(25 小时日)仍是三个日历日", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    expect(usagePeriodKeys("day", 3, now, "Europe/Berlin")).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
  });

  it("DST:纽约 2026-11-02T12:00Z 向前三天跨过 11-01(25 小时日)", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(usagePeriodKeys("day", 3, now, "America/New_York")).toEqual([
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("跨年:上海 2026-12-31T20:00Z 的今天是 2027-01-01", () => {
    const now = new Date("2026-12-31T20:00:00Z");
    expect(usagePeriodKeys("day", 2, now, "Asia/Shanghai")).toEqual([
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  it("其余四档不看 zone(hour 桶与时区无关;周/月/年保持 UTC 权威)", () => {
    // 2026-09-06T17:00Z 是 UTC 的周日,在上海已是周一 01:00——week 仍按 UTC 归上一周。
    const now = new Date("2026-09-06T17:00:00Z");
    for (const g of ["hour", "week", "month", "year"] as const) {
      expect(usagePeriodKeys(g, 3, now, "Asia/Shanghai")).toEqual(
        usagePeriodKeys(g, 3, now),
      );
    }
    expect(usagePeriodKeys("week", 1, now, "Asia/Shanghai")).toEqual([
      "2026-08-31",
    ]);
  });

  it("zone 省略 ≡ 'UTC'(回归:现有断言逐条不变)", () => {
    const now = new Date("2026-09-04T01:30:00Z");
    for (const g of ["hour", "day", "week", "month", "year"] as const) {
      expect(usagePeriodKeys(g, 3, now)).toEqual(
        usagePeriodKeys(g, 3, now, "UTC"),
      );
    }
  });

  it("无效时区抛 RangeError,不静默回落(调用方先校验)", () => {
    expect(() =>
      usagePeriodKeys(
        "day",
        3,
        new Date("2026-09-04T01:30:00Z"),
        "Mars/Olympus",
      ),
    ).toThrow(RangeError);
  });

  it("开区间右端 = 末桶次日,跨月跨年都对", () => {
    expect(usageWindowEndExclusive("2026-09-04")).toBe("2026-09-05");
    expect(usageWindowEndExclusive("2026-09-30")).toBe("2026-10-01");
    expect(usageWindowEndExclusive("2026-12-31")).toBe("2027-01-01");
    expect(usageWindowEndExclusive("2028-02-28")).toBe("2028-02-29");
  });

  it("重切上限与 rollup 共用一个常量(35 天)", () => {
    expect(REBUCKET_HORIZON_DAYS).toBe(35);
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
