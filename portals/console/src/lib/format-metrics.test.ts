import { describe, expect, it } from "vitest";
import { fmtCount, formatBytes } from "./format-metrics";

/**
 * 计量格式化(批 3 收成一份)。配额底池都是 2 的幂,所以是 1024 进位;
 * 两位数以下保留一位小数,三位数与字节整数不带小数。
 */
describe("formatBytes", () => {
  it("字节整数不带小数", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("1024 进位,两位数以下保留一位小数", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(200 * 1024 * 1024)).toBe("200 MB");
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });

  it("三位数不带小数", () => {
    expect(formatBytes(100 * 1024)).toBe("100 KB");
    expect(formatBytes(999.6 * 1024)).toBe("1000 KB");
  });

  it("封顶在 PB,不会越过单位表", () => {
    expect(formatBytes(3 * 1024 ** 5)).toBe("3.0 PB");
    expect(formatBytes(2048 * 1024 ** 5)).toBe("2048 PB");
  });

  it("负数保留符号,非有限值画 0 B 而不是 NaN", () => {
    expect(formatBytes(-1536)).toBe("-1.5 KB");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
  });
});

describe("fmtCount", () => {
  it("千分位", () => {
    expect(fmtCount(0)).toBe("0");
    expect(fmtCount(1234567)).toBe("1,234,567");
  });

  it("非有限值画 0", () => {
    expect(fmtCount(Number.NaN)).toBe("0");
    expect(fmtCount(Number.NEGATIVE_INFINITY)).toBe("0");
  });
});
