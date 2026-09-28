import { describe, expect, it, vi } from "vitest";
import { AddonLifecycleJob, JOB_NAME } from "./addon-lifecycle.job";
import type { AddonService } from "@vxture/service-subscription";
import type { JobHeartbeatService } from "./job-heartbeat.service";

// 节奏夹取本身是共享的（sweep-interval.util.spec），这里不重复测。
// 心跳不是本文件的测试对象——桩只为满足构造参数（同 trial-expiry.job.spec）。

const heartbeat = () => ({
  recordStart: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
});

const jobWith = (
  sweepAddonLifecycle: () => Promise<{
    expiringSoon: number;
    exhausted: number;
    expired: number;
  }>,
  hb = heartbeat(),
) => ({
  hb,
  job: new AddonLifecycleJob(
    { sweepAddonLifecycle } as unknown as AddonService,
    hb as unknown as JobHeartbeatService,
  ),
});

const zero = { expiringSoon: 0, exhausted: 0, expired: 0 };

describe("AddonLifecycleJob.tick", () => {
  it("runs one sweep pass per tick", async () => {
    const sweep = vi.fn().mockResolvedValue(zero);
    const { job } = jobWith(sweep);
    await job.tick();
    await job.tick();
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("skips a tick while a pass is still in flight (same-instance guard)", async () => {
    let release!: (v: typeof zero) => void;
    const gate = new Promise<typeof zero>((r) => (release = r));
    const sweep = vi.fn().mockImplementation(() => gate);
    const { job } = jobWith(sweep);

    const first = job.tick(); // holds the in-flight flag
    await job.tick(); // must no-op
    expect(sweep).toHaveBeenCalledTimes(1);

    release(zero);
    await first;
    await job.tick(); // flag released → runs again
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("survives a failing pass and keeps ticking (heartbeat records the failure)", async () => {
    const sweep = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(zero);
    const { job, hb } = jobWith(sweep);
    await expect(job.tick()).resolves.toBeUndefined();
    expect(hb.recordFailure).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      expect.stringContaining("db down"),
    );
    await job.tick();
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("心跳的 items 是本趟三档发出去的总条数（运维台那一列读它）", async () => {
    const { job, hb } = jobWith(
      vi.fn().mockResolvedValue({ expiringSoon: 2, exhausted: 1, expired: 4 }),
    );
    await job.tick();
    expect(hb.recordStart).toHaveBeenCalledWith(JOB_NAME, expect.any(Number));
    expect(hb.recordSuccess).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      7,
    );
  });
});
