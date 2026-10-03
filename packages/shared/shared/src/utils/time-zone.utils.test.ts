/**
 * time-zone.utils.test.ts — the zone predicate both ends must agree on, and the
 * civil-date projection the usage day keys are built from.
 *
 * ── 钉的是哪几条 ──
 *  1. 写路径与读路径用的是**同一个**判据:IANA 形状 + Intl 认得。别名两种拼法都过
 *     (`Asia/Kolkata` / `Asia/Calcutta`——Node 24.14 的 supportedValuesOf 只列后者、
 *     连 `UTC` 都不列,所以**不能**拿那张表做成员判断,否则 picker 自己给出的值会被拒);
 *     小写变体 / 裸偏移 / 空值 / 非字符串 / 编出来的名一律不过。
 *  2. "UTC" 与 "Etc/UTC" 必须通过:它是平台默认桶时区。
 *  3. 民用日期按时区投影:同一瞬时在上海已是次日、在纽约仍是当日;DST 切换日也只是
 *     普通的一天(投影不做步进,步进由调用方在 Date.UTC 上做)。
 *  4. 无效时区**抛**,不静默回落——静默回落会把 UTC 日贴上用户时区的标签。
 */
import { describe, expect, it } from "vitest";
import {
  USAGE_REBUCKET_HORIZON_DAYS,
  civilDateInZone,
  isIanaTimeZone,
} from "./time-zone.utils";

describe("isIanaTimeZone", () => {
  it("IANA names pass, in either alias spelling, and so do UTC / Etc/UTC", () => {
    for (const z of [
      "Asia/Shanghai",
      "America/New_York",
      "Europe/Berlin",
      "Asia/Kolkata",
      "Asia/Calcutta",
      "America/Argentina/Buenos_Aires",
      "America/Port-au-Prince",
      "Etc/GMT+8",
      "UTC",
      "Etc/UTC",
    ]) {
      expect(isIanaTimeZone(z), z).toBe(true);
    }
  });

  it("lowercase variants, bare offsets, made-up names, empty and non-strings fail", () => {
    for (const z of [
      "asia/shanghai",
      "utc",
      "+08:00",
      "GMT+8",
      "Beijing",
      "Mars/Olympus",
      "Asia/",
      "/Shanghai",
      "",
    ]) {
      expect(isIanaTimeZone(z), z).toBe(false);
    }
    expect(isIanaTimeZone(null)).toBe(false);
    expect(isIanaTimeZone(undefined)).toBe(false);
    expect(isIanaTimeZone(8)).toBe(false);
  });

  it("the re-bucket horizon is 35 days (shared with the rollup window)", () => {
    expect(USAGE_REBUCKET_HORIZON_DAYS).toBe(35);
  });
});

describe("civilDateInZone", () => {
  // 2026-09-03 17:00Z: Shanghai (+08) is already 09-04 01:00; New York (-04) is 09-03 13:00.
  const at = new Date("2026-09-03T17:00:00Z");

  it("projects the same instant to different calendar dates per zone", () => {
    expect(civilDateInZone(at, "UTC")).toEqual({
      year: 2026,
      month: 9,
      day: 3,
    });
    expect(civilDateInZone(at, "Asia/Shanghai")).toEqual({
      year: 2026,
      month: 9,
      day: 4,
    });
    expect(civilDateInZone(at, "America/New_York")).toEqual({
      year: 2026,
      month: 9,
      day: 3,
    });
  });

  it("a DST transition day is just a date (Berlin 2026-10-25, 25 local hours)", () => {
    expect(
      civilDateInZone(new Date("2026-10-25T00:30:00Z"), "Europe/Berlin"),
    ).toEqual({
      year: 2026,
      month: 10,
      day: 25,
    });
    expect(
      civilDateInZone(new Date("2026-10-24T22:30:00Z"), "Europe/Berlin"),
    ).toEqual({
      year: 2026,
      month: 10,
      day: 25,
    });
  });

  it("year boundary follows the zone, not UTC", () => {
    expect(
      civilDateInZone(new Date("2026-12-31T20:00:00Z"), "Asia/Shanghai"),
    ).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it("throws for a zone Intl does not know (callers validate first)", () => {
    expect(() => civilDateInZone(at, "Mars/Olympus")).toThrow(RangeError);
  });
});
