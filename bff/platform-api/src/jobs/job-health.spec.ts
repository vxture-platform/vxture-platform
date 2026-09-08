import { describe, expect, it } from "vitest";
import {
  STALL_FLOOR_MS,
  STARTUP_GRACE_MS,
  classifyJob,
  stallThresholdMs,
  type JobHealthRow,
} from "./job-health";

const NOW = 1_757_000_000_000;
const UP = STARTUP_GRACE_MS + 1; // 过了启动宽限

function row(over: Partial<JobHealthRow> = {}): JobHealthRow {
  return {
    jobName: "trial-expiry",
    status: "success",
    intervalMs: 60_000,
    lastStartedAt: new Date(NOW - 10_000),
    lastError: null,
    failureCount: 0,
    ...over,
  };
}

describe("stallThresholdMs", () => {
  it("低频作业按 3×interval", () => {
    expect(stallThresholdMs(3600_000)).toBe(3 * 3600_000);
  });

  it("高频作业落到 5 分钟下限——3×10s 会被一次 GC 误伤", () => {
    expect(stallThresholdMs(10_000)).toBe(STALL_FLOOR_MS);
    expect(stallThresholdMs(60_000)).toBe(STALL_FLOOR_MS);
  });

  // 断言的是**行为**（落在下限上），不是「等于某个用默认周期算出来的式子」——
  // 后者两边会同时变，测不出默认周期到底有没有起作用（2026-09-08 变异测试的教训）。
  it("interval 缺失 / 非法时由下限单独决定，绝不返回 0", () => {
    for (const bad of [null, 0, -5]) {
      expect(stallThresholdMs(bad)).toBe(STALL_FLOOR_MS);
    }
  });
});

describe("classifyJob", () => {
  it("正常在跑 → ok", () => {
    expect(classifyJob(row(), NOW, UP)).toBe("ok");
  });

  it("status=failed → failed", () => {
    expect(classifyJob(row({ status: "failed" }), NOW, UP)).toBe("failed");
  });

  it("超过阈值没动 → stalled（边界：恰好等于阈值还不算）", () => {
    const t = stallThresholdMs(3600_000);
    const at = (idle: number) =>
      row({ intervalMs: 3600_000, lastStartedAt: new Date(NOW - idle) });
    expect(classifyJob(at(t), NOW, UP)).toBe("ok");
    expect(classifyJob(at(t + 1), NOW, UP)).toBe("stalled");
  });

  it("卡在 running 出不来也算静默——判据不看 status，只看多久没开跑", () => {
    const stuck = row({
      status: "running",
      lastStartedAt: new Date(NOW - STALL_FLOOR_MS - 1),
    });
    expect(classifyJob(stuck, NOW, UP)).toBe("stalled");
  });

  it("既 failed 又早就不动 → 报静默，不报失败", () => {
    // 那条 last_error 可能是几天前的，与「现在整条停摆」不是同一件事。
    const dead = row({
      status: "failed",
      lastStartedAt: new Date(NOW - STALL_FLOOR_MS - 1),
    });
    expect(classifyJob(dead, NOW, UP)).toBe("stalled");
  });

  it("启动宽限内不判静默，但照常报失败", () => {
    const young = STARTUP_GRACE_MS - 1;
    const idle = row({ lastStartedAt: new Date(NOW - STALL_FLOOR_MS - 1) });
    expect(classifyJob(idle, NOW, young)).toBe("ok");
    // 失败不吃宽限：status='failed' 是上一轮的真实结论，重启不会让它变得不真。
    expect(classifyJob({ ...idle, status: "failed" }, NOW, young)).toBe(
      "failed",
    );
  });

  it("从没跑过（last_started_at 为空）不判静默——那是没到首次触发，不是死了", () => {
    expect(classifyJob(row({ lastStartedAt: null }), NOW, UP)).toBe("ok");
  });
});
