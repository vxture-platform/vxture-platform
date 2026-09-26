/**
 * quota-period.utils.test.ts — 锚定推进（铁律五）的算式验收。
 *
 * 会错而且**不报错**的几处，逐条钉：
 *   ① 月末锚点要每步从**原始锚点**算，不是在上次结果上再加一个月——后者会把 31 号永久
 *      拖成 28 号，客户的刷新日一年往前挪三天。
 *   ② `now` 早于锚点时返回锚点本身，不是倒推一个周期。
 *   ③ 长期没消费的池直接跳到当前那一格，不一格一格补。
 *   ④ 缺锚点时退回用 `current_period_start` 当锚点——不能静默落回日历对齐，那正是这次
 *      要修掉的东西。
 */
import { describe, expect, it } from "vitest";
import { anchoredPeriodStart, needsQuotaReset } from "./quota-period.utils";

const d = (iso: string) => new Date(iso);

describe("月周期：从订阅那天推进，不按自然月", () => {
  const anchor = d("2026-09-15T08:30:00.000Z");

  it("锚点当天之前 → 还在第一个周期，起点就是锚点", () => {
    expect(
      anchoredPeriodStart(anchor, "month", d("2026-09-20T00:00:00Z")),
    ).toEqual(anchor);
  });

  it("下个月 15 号之前 → 仍是 9/15 那一格（不是 10/01）", () => {
    expect(
      anchoredPeriodStart(anchor, "month", d("2026-10-14T23:59:59Z")),
    ).toEqual(anchor);
  });

  it("到了 10/15 08:30 → 翻到 10/15 那一格", () => {
    expect(
      anchoredPeriodStart(anchor, "month", d("2026-10-15T08:30:00Z")),
    ).toEqual(d("2026-10-15T08:30:00.000Z"));
  });

  it("10/15 08:29 还差一分钟 → 仍在 9/15 那一格", () => {
    expect(
      anchoredPeriodStart(anchor, "month", d("2026-10-15T08:29:00Z")),
    ).toEqual(anchor);
  });
});

describe("月末锚点：夹取，但不累积漂移", () => {
  const anchor = d("2026-01-31T00:00:00.000Z");

  it("2 月没有 31 号 → 落 2/28", () => {
    expect(
      anchoredPeriodStart(anchor, "month", d("2026-03-01T00:00:00Z")),
    ).toEqual(d("2026-02-28T00:00:00.000Z"));
  });

  it("**3 月回到 31 号** —— 每步都从原始锚点算", () => {
    expect(
      anchoredPeriodStart(anchor, "month", d("2026-04-01T00:00:00Z")),
    ).toEqual(d("2026-03-31T00:00:00.000Z"));
  });

  it("闰年 2 月落 2/29", () => {
    const leapAnchor = d("2028-01-31T00:00:00.000Z");
    expect(
      anchoredPeriodStart(leapAnchor, "month", d("2028-03-01T00:00:00Z")),
    ).toEqual(d("2028-02-29T00:00:00.000Z"));
  });

  it("跨年也从原始锚点算", () => {
    expect(
      anchoredPeriodStart(anchor, "month", d("2027-01-31T12:00:00Z")),
    ).toEqual(d("2027-01-31T00:00:00.000Z"));
  });
});

describe("日周期", () => {
  const anchor = d("2026-09-15T08:30:00.000Z");

  it("同一格内不推进", () => {
    expect(
      anchoredPeriodStart(anchor, "day", d("2026-09-16T08:29:00Z")),
    ).toEqual(anchor);
  });

  it("满 24 小时翻一格 —— 是「订阅时刻」不是自然日零点", () => {
    expect(
      anchoredPeriodStart(anchor, "day", d("2026-09-16T08:30:00Z")),
    ).toEqual(d("2026-09-16T08:30:00.000Z"));
  });

  it("停了很久 → 直接跳到当前那一格，不一格一格补", () => {
    expect(
      anchoredPeriodStart(anchor, "day", d("2026-12-01T09:00:00Z")),
    ).toEqual(d("2026-12-01T08:30:00.000Z"));
  });
});

describe("needsQuotaReset", () => {
  const anchor = d("2026-09-15T08:30:00.000Z");

  it("none 永不重置", () => {
    expect(
      needsQuotaReset({
        resetPeriod: "none",
        periodAnchor: anchor,
        currentPeriodStart: d("2020-01-01T00:00:00Z"),
        now: d("2026-10-20T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("从没初始化过（current 为 null）→ 该重置", () => {
    expect(
      needsQuotaReset({
        resetPeriod: "month",
        periodAnchor: anchor,
        currentPeriodStart: null,
        now: d("2026-09-16T00:00:00Z"),
      }),
    ).toBe(true);
  });

  it("停在 9/15 那一格、现在还没到 10/15 → 不重置", () => {
    expect(
      needsQuotaReset({
        resetPeriod: "month",
        periodAnchor: anchor,
        currentPeriodStart: anchor,
        now: d("2026-10-14T00:00:00Z"),
      }),
    ).toBe(false);
  });

  it("过了 10/15 → 重置", () => {
    expect(
      needsQuotaReset({
        resetPeriod: "month",
        periodAnchor: anchor,
        currentPeriodStart: anchor,
        now: d("2026-10-15T09:00:00Z"),
      }),
    ).toBe(true);
  });

  it("**存量池**：current 停在日历月初、锚点是 15 号 → 切换后立刻补一次重置", () => {
    // 这是切换当天会发生的事：旧口径把 current 落在 9/01，锚定口径的当前格是 9/15。
    expect(
      needsQuotaReset({
        resetPeriod: "month",
        periodAnchor: anchor,
        currentPeriodStart: d("2026-09-01T00:00:00Z"),
        now: d("2026-09-26T00:00:00Z"),
      }),
    ).toBe(true);
  });

  it("缺锚点 → 拿 current 当锚点推进，**不落回日历对齐**", () => {
    // 锚点缺失、current=9/10：一个月后是 10/10，而不是 10/01。
    expect(
      needsQuotaReset({
        resetPeriod: "month",
        periodAnchor: null,
        currentPeriodStart: d("2026-09-10T00:00:00Z"),
        now: d("2026-10-05T00:00:00Z"),
      }),
    ).toBe(false);
    expect(
      needsQuotaReset({
        resetPeriod: "month",
        periodAnchor: null,
        currentPeriodStart: d("2026-09-10T00:00:00Z"),
        now: d("2026-10-11T00:00:00Z"),
      }),
    ).toBe(true);
  });
});
