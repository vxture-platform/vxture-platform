/**
 * job-health-alert.job.spec.ts —— 作业健康这一条要把 last_started_at 传下去，
 * 且通告写失败不许影响邮件（2026-09-28 第二批 C-4 / C-5）。
 *
 * 分两半，因为坏法有两种：
 *   · 作业这一半：判定后**传什么**给告警侧。去重键靠 last_started_at 分 episode，
 *     漏传它不会报错——通告照写，只是每一轮都写成新的一条，运营台被刷屏。
 *   · 装配这一半：通告与邮件是两条路，谁也不许拖累谁。这里用一只「写通告必炸」的池
 *     证明邮件那条路照走（结论仍然是 noRecipient），反过来也证明通告真的被写了。
 * 静默 / 失败的裁定本身在 job-health.spec.ts，不在这里重复。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { JobHealthAlertJob } from "./job-health-alert.job";
import type { JobHeartbeatService } from "./job-heartbeat.service";
import {
  CUSTOMER_BLOCKING_JOBS,
  OperatorAlertsWiring,
  composeJobHealthNotice,
  composeSelfHealGaveUpNotice,
} from "../notifications/operator-alerts.wiring";

const noopHeartbeat = {
  recordStart: vi.fn().mockResolvedValue(undefined),
  recordSuccess: vi.fn().mockResolvedValue(undefined),
  recordFailure: vi.fn().mockResolvedValue(undefined),
} as unknown as JobHeartbeatService;

const NOW = new Date("2026-09-28T12:00:00.000Z");
const STARTED = new Date("2026-09-28T11:59:00.000Z");

/** provisioning.background_jobs 的一行（只装本作业读的那几列）。 */
function jobsPool(
  rows: Record<string, unknown>[],
): Pool & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { query } as unknown as Pool & { query: ReturnType<typeof vi.fn> };
}

describe("JobHealthAlertJob.pass —— 传给告警侧的事实", () => {
  it("失败的那一行连 last_started_at 一起传下去（去重键靠它分 episode）", async () => {
    const alertJobHealth = vi.fn().mockResolvedValue({
      sent: 1,
      failed: 0,
      suppressed: false,
      noRecipient: false,
    });
    const pool = jobsPool([
      {
        job_name: "usage-rollup",
        status: "failed",
        interval_ms: 60_000,
        last_started_at: STARTED,
        last_error: "boom",
        failure_count: "2",
      },
    ]);
    const job = new JobHealthAlertJob(
      pool,
      { alertJobHealth } as unknown as OperatorAlertsWiring,
      noopHeartbeat,
    );
    await job.tick();
    expect(alertJobHealth).toHaveBeenCalledTimes(1);
    expect(alertJobHealth.mock.calls[0]![0]).toMatchObject({
      verdict: "failed",
      jobName: "usage-rollup",
      failureCount: 2,
      lastError: "boom",
      lastStartedAt: STARTED,
    });
  });

  it("健康的行一条都不报（免得把「最近没事干」当成坏了）", async () => {
    const alertJobHealth = vi.fn();
    const job = new JobHealthAlertJob(
      jobsPool([
        {
          job_name: "usage-rollup",
          status: "success",
          interval_ms: 60_000,
          last_started_at: STARTED,
          last_error: null,
          failure_count: "0",
        },
      ]),
      { alertJobHealth } as unknown as OperatorAlertsWiring,
      noopHeartbeat,
    );
    await job.tick();
    expect(alertJobHealth).not.toHaveBeenCalled();
  });
});

describe("composeJobHealthNotice", () => {
  const facts = (over: Record<string, unknown> = {}) =>
    ({
      verdict: "stalled" as const,
      jobName: "usage-rollup",
      idleMs: 42 * 60_000,
      thresholdMs: 5 * 60_000,
      intervalMs: 60_000,
      lastError: null,
      failureCount: 0,
      lastStartedAt: STARTED,
      now: NOW,
      ...over,
    }) as Parameters<typeof composeJobHealthNotice>[0];

  it("静默 = critical、只投 opera、给任务调度的链接、不过期", () => {
    const notice = composeJobHealthNotice(facts());
    expect(notice.severity).toBe("critical");
    expect(notice.targetPlanes).toEqual(["opera"]);
    expect(notice.link).toBe("/ops/jobs");
    expect(notice.expiresAt).toBeNull();
    expect(notice.title).toContain("usage-rollup");
    expect(notice.body).toContain("42 分钟");
  });

  it("失败 = warning、30 天后退出列表", () => {
    const notice = composeJobHealthNotice(
      facts({ verdict: "failed", failureCount: 3, lastError: "boom" }),
    );
    expect(notice.severity).toBe("warning");
    expect(notice.body).toContain("boom");
    expect(notice.expiresAt).not.toBeNull();
    expect(notice.expiresAt!.getTime()).toBe(
      NOW.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
  });

  it("卡住客户的三条作业同时投 admin，且那时不给链接（/ops/jobs 在 admin 里不存在）", () => {
    for (const jobName of CUSTOMER_BLOCKING_JOBS) {
      const notice = composeJobHealthNotice(facts({ jobName }));
      expect(notice.targetPlanes).toEqual(["opera", "admin"]);
      expect(notice.link).toBeNull();
      expect(notice.body).toContain("客户会直接受影响");
    }
    // 名单里的三条必须与各作业的 JOB_NAME 逐字一致，否则这条分支永远走不到。
    expect([...CUSTOMER_BLOCKING_JOBS].sort()).toEqual([
      "order-payment-expiry",
      "provisioning-dispatch",
      "subscription-renewal",
    ]);
  });

  it("去重键 = job_{裁定}:{作业名}:{last_started_at}，一个 episode 一条", () => {
    const stalled = composeJobHealthNotice(facts());
    expect(stalled.referenceType).toBe("ops_signal");
    expect(stalled.referenceId).toBe(
      `job_stalled:usage-rollup:${STARTED.toISOString()}`,
    );
    // 同一段静默扫多少轮都是同一个键（last_started_at 冻住了）。
    expect(
      composeJobHealthNotice(facts({ idleMs: 99 * 60_000 })).referenceId,
    ).toBe(stalled.referenceId);
    // 从没跑过的作业没有时刻可用 → 按当天收敛，不能变成「这辈子只播一条」。
    expect(
      composeJobHealthNotice(facts({ lastStartedAt: null })).referenceId,
    ).toBe("job_stalled:usage-rollup:never:2026-09-28");
  });
});

describe("composeSelfHealGaveUpNotice", () => {
  it("critical、只投 admin、链接走 order_no、不过期", () => {
    const notice = composeSelfHealGaveUpNotice({
      orderNo: "SO202600100",
      attempts: 3,
      lastError: "provisioning timeout",
    });
    expect(notice.severity).toBe("critical");
    expect(notice.targetPlanes).toEqual(["admin"]);
    expect(notice.link).toBe("/orders/SO202600100");
    expect(notice.expiresAt).toBeNull();
    expect(notice.referenceId).toBe("selfheal_gave_up:SO202600100:3");
    expect(notice.title).toContain("SO202600100");
    expect(notice.body).toContain("provisioning timeout");
  });

  it("没留下原因也照发一条（缺原因不是不发的理由）", () => {
    const notice = composeSelfHealGaveUpNotice({
      orderNo: "SO202600101",
      attempts: 3,
      lastError: null,
    });
    expect(notice.body).toContain("没有留下失败原因");
  });
});

/**
 * 装配那一半：通告与邮件互不拖累。
 *
 * 一只池装三种查询：通告的 insert（可炸）、静默窗口的账本、运营账号表。
 * 账号表返回空 → 邮件侧的结论是 noRecipient，正好是个稳定可断言的出口。
 */
function wiringPool(opts: { noticeThrows?: boolean }): {
  pool: Pool;
  notices: () => unknown[][];
} {
  const noticeCalls: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("admin.operator_notices")) {
      noticeCalls.push(params);
      if (opts.noticeThrows) throw new Error("42501 permission denied");
      return { rows: [{ id: "notice-1" }], rowCount: 1 };
    }
    // 账本（静默窗口）与运营账号表都回空：没发过、也没人可达。
    return { rows: [], rowCount: 0 };
  });
  return {
    pool: { query } as unknown as Pool,
    notices: () => noticeCalls,
  };
}

describe("OperatorAlertsWiring —— 通告与邮件是两条路", () => {
  it("作业健康：通告写成功，邮件照走", async () => {
    const { pool, notices } = wiringPool({});
    const wiring = new OperatorAlertsWiring(pool, {} as never);
    const result = await wiring.alertJobHealth({
      verdict: "stalled",
      jobName: "usage-rollup",
      idleMs: 42 * 60_000,
      thresholdMs: 5 * 60_000,
      intervalMs: 60_000,
      lastError: null,
      failureCount: 0,
      lastStartedAt: STARTED,
    });
    expect(notices()).toHaveLength(1);
    expect(result.noRecipient).toBe(true);
  });

  it("作业健康：通告写炸了，邮件那条路不受影响", async () => {
    const { pool, notices } = wiringPool({ noticeThrows: true });
    const wiring = new OperatorAlertsWiring(pool, {} as never);
    const result = await wiring.alertJobHealth({
      verdict: "failed",
      jobName: "usage-rollup",
      idleMs: 0,
      thresholdMs: 5 * 60_000,
      intervalMs: 60_000,
      lastError: "boom",
      failureCount: 1,
      lastStartedAt: STARTED,
    });
    expect(notices()).toHaveLength(1);
    expect(result.noRecipient).toBe(true);
  });

  it("自愈放弃：通告写炸了，也不许把这次上报变成一个异常", async () => {
    const { pool, notices } = wiringPool({ noticeThrows: true });
    const wiring = new OperatorAlertsWiring(pool, {} as never);
    const result = await wiring.orderSelfHealGaveUp({
      orderId: "11111111-1111-4111-8111-111111111111",
      orderNo: "SO202600100",
      attempts: 3,
      lastError: null,
    });
    expect(notices()).toHaveLength(1);
    expect(result.noRecipient).toBe(true);
  });
});
