import { describe, expect, it, vi } from "vitest";
import {
  ProvisioningDispatchJob,
  dispatchIntervalMs,
} from "./provisioning-dispatch.job";
import type { ProvisioningService } from "@vxture/service-provisioning";
import type { JobHeartbeatService } from "./job-heartbeat.service";

// 心跳写入不是本文件的测试对象（见 job-heartbeat.service.spec.ts 的位置——目前无独立
// spec，方法本身只是三条 UPSERT，行为由 provisioning.background_jobs 的 DDL 约束保底）；
// 这里只给一个吞掉调用的哑桩，不让 tick() 因为缺这个依赖而报错。
const noopHeartbeat = {
  recordStart: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
} as unknown as JobHeartbeatService;

const jobWith = (dispatchPending: () => Promise<unknown>) =>
  new ProvisioningDispatchJob(
    { dispatchPending } as unknown as ProvisioningService,
    noopHeartbeat,
  );

describe("dispatchIntervalMs", () => {
  it("defaults to 10s and enforces a 1s floor", () => {
    expect(dispatchIntervalMs(undefined)).toBe(10_000);
    expect(dispatchIntervalMs("abc")).toBe(10_000);
    expect(dispatchIntervalMs("500")).toBe(10_000);
    expect(dispatchIntervalMs("30000")).toBe(30_000);
  });
});

describe("ProvisioningDispatchJob.tick", () => {
  it("runs one dispatch pass per tick", async () => {
    const dispatch = vi.fn().mockResolvedValue({ claimed: 0 });
    const job = jobWith(dispatch);
    await job.tick();
    await job.tick();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("skips a tick while a pass is still in flight (same-instance guard)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const dispatch = vi.fn().mockImplementation(() => gate);
    const job = jobWith(dispatch);

    const first = job.tick(); // holds the in-flight flag
    await job.tick(); // must no-op
    expect(dispatch).toHaveBeenCalledTimes(1);

    release();
    await first;
    await job.tick(); // flag released → runs again
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("survives a failing pass and keeps ticking", async () => {
    const dispatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ claimed: 0 });
    const job = jobWith(dispatch);
    await expect(job.tick()).resolves.toBeUndefined();
    await job.tick();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
});
