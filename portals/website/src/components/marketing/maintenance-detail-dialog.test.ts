/**
 * maintenance-detail-dialog.test.ts —— 「升级维护中」弹窗的倒计时算式（2026-09-28）。
 *
 * 弹窗本身是 DS 三件 + 几个 p，不值得渲染测；会错而且**不报错**的是这段算式：
 *   ① 过点要落到 elapsed，不翻负数；正好到点归到「已过」那一侧。
 *   ② 整天拆出去之后小时恒 < 24，两位方格永远放得下。
 *   ③ 秒向上取整：剩半秒是 00:00:01，不是 00:00:00。
 */
import { describe, expect, it } from "vitest";
import { maintenanceCountdown } from "./maintenance-detail.logic";

const NOW = Date.parse("2026-09-28T12:00:00Z");

describe("倒计时：两位数字串，一格一位", () => {
  it("还有 2 小时 17 分 30 秒 → 02 / 17 / 30，天数 0", () => {
    expect(maintenanceCountdown("2026-09-28T14:17:30Z", NOW)).toEqual({
      kind: "running",
      days: 0,
      hours: "02",
      minutes: "17",
      seconds: "30",
    });
  });

  it("超过一天：整天拆出去，方格里只剩不足一天的部分（小时恒 < 24）", () => {
    expect(maintenanceCountdown("2026-10-01T13:00:05Z", NOW)).toEqual({
      kind: "running",
      days: 3,
      hours: "01",
      minutes: "00",
      seconds: "05",
    });
  });

  it("正好 24 小时 → 1 天 00:00:00（不是 24:00:00）", () => {
    expect(maintenanceCountdown("2026-09-29T12:00:00Z", NOW)).toEqual({
      kind: "running",
      days: 1,
      hours: "00",
      minutes: "00",
      seconds: "00",
    });
  });

  it("剩半秒 → 00:00:01（向上取整：「还有 0 秒」与「已到」不该同时成立）", () => {
    expect(maintenanceCountdown("2026-09-28T12:00:00.500Z", NOW)).toEqual({
      kind: "running",
      days: 0,
      hours: "00",
      minutes: "00",
      seconds: "01",
    });
  });
});

describe("倒计时：过点落到 elapsed，不翻负数", () => {
  it("已经过点 → elapsed", () => {
    expect(maintenanceCountdown("2026-09-28T11:59:59Z", NOW)).toEqual({
      kind: "elapsed",
    });
    expect(maintenanceCountdown("2026-09-20T00:00:00Z", NOW)).toEqual({
      kind: "elapsed",
    });
  });

  it("正好到点 → elapsed（边界归到「已过」那一侧）", () => {
    expect(maintenanceCountdown("2026-09-28T12:00:00Z", NOW)).toEqual({
      kind: "elapsed",
    });
  });

  it("解析不出来 → invalid，不抛（界面据此不画倒计时）", () => {
    expect(maintenanceCountdown("tomorrow-ish", NOW)).toEqual({
      kind: "invalid",
    });
  });
});
