import { describe, expect, it, vi } from "vitest";
import { InvitationExpiryJob, JOB_NAME } from "./invitation-expiry.job";
import type { OrganizationService } from "@vxture/service-organization";
import type { JobHeartbeatService } from "./job-heartbeat.service";

// 节奏夹取本身是共享的（sweep-interval.util.spec），这里不重复测。
// 心跳不是本文件的测试对象——桩只为满足构造参数（同 addon-lifecycle.job.spec）。

type Counts = { expired: number; notified: number; saturated: boolean };

const heartbeat = () => ({
  recordStart: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
});

const jobWith = (
  sweepExpiredInvitations: () => Promise<Counts>,
  hb = heartbeat(),
) => ({
  hb,
  job: new InvitationExpiryJob(
    { sweepExpiredInvitations } as unknown as OrganizationService,
    hb as unknown as JobHeartbeatService,
  ),
});

const zero: Counts = { expired: 0, notified: 0, saturated: false };

describe("InvitationExpiryJob.tick", () => {
  it("runs one sweep pass per tick", async () => {
    const sweep = vi.fn().mockResolvedValue(zero);
    const { job } = jobWith(sweep);
    await job.tick();
    await job.tick();
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it("skips a tick while a pass is still in flight (same-instance guard)", async () => {
    let release!: (v: Counts) => void;
    const gate = new Promise<Counts>((r) => (release = r));
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

  it("心跳的 items 是本趟改成 expired 的行数，不是通知条数", async () => {
    /* 存量闸门之外的行会转移而不通知，首趟两个数字差得很远。拿通知条数当 items，
       运维台上一趟正在啃存量的扫描会显示成「没干活」。 */
    const { job, hb } = jobWith(
      vi.fn().mockResolvedValue({ expired: 12, notified: 2, saturated: false }),
    );
    await job.tick();
    expect(hb.recordStart).toHaveBeenCalledWith(JOB_NAME, expect.any(Number));
    expect(hb.recordSuccess).toHaveBeenCalledWith(
      JOB_NAME,
      expect.any(Number),
      12,
    );
  });

  it("存量闸门的天数从环境变量来，且不替服务层决定 limit", async () => {
    vi.stubEnv("INVITATION_EXPIRY_BACKLOG_DAYS", "10");
    const sweep = vi.fn().mockResolvedValue(zero);
    const { job } = jobWith(sweep);
    await job.tick();
    expect(sweep).toHaveBeenCalledWith({ backlogDays: 10 });
    vi.unstubAllEnvs();
  });
});
