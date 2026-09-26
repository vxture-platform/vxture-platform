/**
 * suspension-detail-dialog.spec.ts —— 暂停详情弹窗的两段算式（2026-09-26）。
 *
 * 弹窗本身是几个 div，不值得渲染测；会错而且**不报错**的是这两段：
 *
 *   ① 倒计时过点之后要落回「已暂停 N 天」，**不翻负数**。估计错了是常事，界面不该把它
 *      演成一个承诺被违背的样子（而倒计时的终点是运营填的估计，不是平台的承诺）。
 *   ② 「已暂停 N 天」向上取整到 1：停两小时也算一天，与顺延的取整口径一致——两处用不同
 *      的取整，客户会看到「已暂停 0 天」却被顺延了 1 天。
 *
 * 另有一条不在本文件、但同族的坑值得记在这里：这几条文案带占位符，**必须用 `t.raw` 取
 * 模板**交给弹窗在渲染时填。用 `t(key, { days: 0 })` 会在构造 labels 时就把占位符换掉，
 * 结果永远显示「已暂停 0 天」，静默。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { daysSince, remainingUntil } from "./suspension-detail.logic";

const NOW = new Date("2026-09-26T12:00:00Z");

afterEach(() => vi.useRealTimers());

function at(now: Date) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
}

describe("已暂停多久：向上取整到 1 天", () => {
  it("停了两小时 → 1 天（不是 0 天）", () => {
    at(NOW);
    expect(daysSince("2026-09-26T10:00:00Z")).toBe(1);
  });

  it("停了整 3 天 → 3 天", () => {
    at(NOW);
    expect(daysSince("2026-09-23T12:00:00Z")).toBe(3);
  });

  it("停了 3 天零 1 小时 → 4 天（与顺延同口径：不足一天也算一天）", () => {
    at(NOW);
    expect(daysSince("2026-09-23T11:00:00Z")).toBe(4);
  });

  it("解析不出来 → 0，不抛（界面据此不渲染那一行）", () => {
    at(NOW);
    expect(daysSince("not-a-date")).toBe(0);
  });
});

describe("倒计时：过点落回 null，不翻负数", () => {
  it("还有 2 天 3 小时", () => {
    at(NOW);
    expect(remainingUntil("2026-09-28T15:00:00Z")).toBe("2d 3h");
  });

  it("还有 5 小时 30 分", () => {
    at(NOW);
    expect(remainingUntil("2026-09-26T17:30:00Z")).toBe("5h 30m");
  });

  it("还有 20 分钟", () => {
    at(NOW);
    expect(remainingUntil("2026-09-26T12:20:00Z")).toBe("20m");
  });

  it("**已经过点 → null**（调用方落回「已暂停 N 天」，不显示负数）", () => {
    at(NOW);
    expect(remainingUntil("2026-09-26T11:59:00Z")).toBeNull();
    expect(remainingUntil("2026-09-20T00:00:00Z")).toBeNull();
  });

  it("正好到点 → null（边界归到「已过」那一侧）", () => {
    at(NOW);
    expect(remainingUntil("2026-09-26T12:00:00Z")).toBeNull();
  });

  it("运营没填 → null（没有终点就没有倒计时，不拿 60 天上限顶替）", () => {
    at(NOW);
    expect(remainingUntil(null)).toBeNull();
  });

  it("填了个解析不出来的值 → null，不抛", () => {
    at(NOW);
    expect(remainingUntil("tomorrow-ish")).toBeNull();
  });
});
