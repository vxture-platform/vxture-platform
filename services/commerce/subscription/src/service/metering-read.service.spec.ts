/**
 * metering-read.service.spec.ts — 桶时区裁决(owner 裁定 4,2026-10-04)。
 *
 * ── 钉的是哪几条 ──
 *  1. resolveBucketZone 五个分支各一条:没设 / 设了 UTC / 认不出 / 超 35 天 / 非 day 档。
 *     顺序就是优先级,'unsupported' 必须排在 'retention' 前面(时区坏了比窗口太长更该先说)。
 *  2. getUsageTrend 按裁决选表:用户时区 → 小时表重切(fromDay / toDayExclusive 按该时区
 *     的今天算);UTC → 各档权威表。两条路互斥,一次请求只能走一条。
 *  3. 校验是双重的:Node 不认的名**不去问库**;Node 认、库不认 → 'unsupported'。
 *  4. pg_timezone_names 的结果按进程缓存一小时:同一个名两次请求只问库一次,过期再问。
 */
import { describe, expect, it, vi } from "vitest";
import {
  MeteringReadService,
  ZONE_CHECK_TTL_MS,
  resolveBucketZone,
} from "./metering-read.service";

describe("resolveBucketZone", () => {
  it("没设时区 → UTC,无原因", () => {
    expect(resolveBucketZone("day", 30, null, false)).toEqual({
      bucketZone: "UTC",
      reason: null,
    });
  });

  it("设的就是 UTC → UTC,无原因(已按用户时区)", () => {
    expect(resolveBucketZone("day", 30, "UTC", true)).toEqual({
      bucketZone: "UTC",
      reason: null,
    });
  });

  it("认不出的时区 → UTC,'unsupported'", () => {
    expect(resolveBucketZone("day", 30, "Mars/Olympus", false)).toEqual({
      bucketZone: "UTC",
      reason: "unsupported",
    });
  });

  it("超过 35 天 → UTC,'retention';恰好 35 天仍按用户时区", () => {
    expect(resolveBucketZone("day", 36, "Asia/Shanghai", true)).toEqual({
      bucketZone: "UTC",
      reason: "retention",
    });
    expect(resolveBucketZone("day", 35, "Asia/Shanghai", true)).toEqual({
      bucketZone: "Asia/Shanghai",
      reason: null,
    });
  });

  it("非 day 档 → UTC;用户设了非 UTC 时区时标 'granularity',否则无原因", () => {
    expect(resolveBucketZone("week", 12, "Asia/Shanghai", true)).toEqual({
      bucketZone: "UTC",
      reason: "granularity",
    });
    expect(resolveBucketZone("hour", 24, "Asia/Shanghai", true)).toEqual({
      bucketZone: "UTC",
      reason: "granularity",
    });
    expect(resolveBucketZone("month", 12, null, false)).toEqual({
      bucketZone: "UTC",
      reason: null,
    });
    expect(resolveBucketZone("year", 5, "UTC", true)).toEqual({
      bucketZone: "UTC",
      reason: null,
    });
  });

  it("'unsupported' 优先于 'retention'(两条都成立时先说时区坏了)", () => {
    expect(resolveBucketZone("day", 90, "Mars/Olympus", false)).toEqual({
      bucketZone: "UTC",
      reason: "unsupported",
    });
  });

  it("'unsupported' 也优先于 'granularity':hour / week 档遇坏名先说时区坏了", () => {
    // 2026-10-04 审查:此前 hour 档一律报 'granularity',页面拿坏名去标轴,
    // 说明写「按 Mars/Olympus 显示」而刻度静默回落成 UTC 的 HH:MM:SS。
    expect(resolveBucketZone("hour", 24, "Mars/Olympus", false)).toEqual({
      bucketZone: "UTC",
      reason: "unsupported",
    });
    expect(resolveBucketZone("week", 12, "Mars/Olympus", false)).toEqual({
      bucketZone: "UTC",
      reason: "unsupported",
    });
  });
});

type Row = {
  period: string;
  productCode: string;
  productName: string;
  total: number;
};

function makeService(opts: { knownInDb?: boolean; rows?: Row[] } = {}) {
  const repo = {
    findDefaultWorkspaceId: vi.fn(),
    listTrendRows: vi.fn(async () => opts.rows ?? []),
    listTrendRowsLocalDays: vi.fn(async () => opts.rows ?? []),
    isKnownTimeZone: vi.fn(async () => opts.knownInDb ?? true),
  };
  return { repo, service: new MeteringReadService(repo as never) };
}

const WS = "00000000-0000-4000-8000-0000000000aa";

describe("MeteringReadService.getUsageTrend —— 按裁决选表", () => {
  it("用户时区 + day 档 + 窗口在 35 天内 → 小时表重切,窗口按该时区的今天算", async () => {
    const { repo, service } = makeService({
      rows: [
        {
          period: "2026-09-04",
          productCode: "a",
          productName: "A",
          total: 7,
        },
      ],
    });
    // 2026-09-03T17:00Z:上海已是 09-04 01:00 → 末桶 09-04,首桶 09-02,右端 09-05。
    const res = await service.getUsageTrend(
      {
        workspaceId: WS,
        metric: "ai.credit",
        granularity: "day",
        span: 3,
        zone: "Asia/Shanghai",
      },
      new Date("2026-09-03T17:00:00Z"),
    );
    expect(repo.listTrendRowsLocalDays).toHaveBeenCalledWith({
      workspaceId: WS,
      metric: "ai.credit",
      zone: "Asia/Shanghai",
      fromDay: "2026-09-02",
      toDayExclusive: "2026-09-05",
    });
    expect(repo.listTrendRows).not.toHaveBeenCalled();
    expect(res.bucketZone).toBe("Asia/Shanghai");
    expect(res.userZone).toBe("Asia/Shanghai");
    expect(res.zoneFallbackReason).toBeNull();
    expect(res.buckets.map((b) => b.period)).toEqual([
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
    ]);
    expect(res.buckets.map((b) => b.total)).toEqual([0, 0, 7]);
  });

  it("没设时区 → UTC 权威表,响应 userZone = null", async () => {
    const { repo, service } = makeService();
    const res = await service.getUsageTrend(
      {
        workspaceId: WS,
        metric: "ai.credit",
        granularity: "day",
        span: 3,
        zone: null,
      },
      new Date("2026-09-03T17:00:00Z"),
    );
    expect(repo.listTrendRows).toHaveBeenCalledWith({
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "day",
      windowStart: "2026-09-01",
    });
    expect(repo.listTrendRowsLocalDays).not.toHaveBeenCalled();
    expect(repo.isKnownTimeZone).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      bucketZone: "UTC",
      userZone: null,
      zoneFallbackReason: null,
    });
    expect(res.buckets.map((b) => b.period)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("空串时区当作没设(写路径今天把「清空」落成 NULL;存量行可能还是 '')", async () => {
    const { repo, service } = makeService();
    const res = await service.getUsageTrend({
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "day",
      span: 3,
      zone: "  ",
    });
    expect(res.userZone).toBeNull();
    expect(res.zoneFallbackReason).toBeNull();
    expect(repo.isKnownTimeZone).not.toHaveBeenCalled();
  });

  it("Node 认不出的名**不去问库**,回 UTC + 'unsupported'", async () => {
    const { repo, service } = makeService();
    const res = await service.getUsageTrend({
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "day",
      span: 30,
      zone: "Mars/Olympus",
    });
    expect(repo.isKnownTimeZone).not.toHaveBeenCalled();
    expect(repo.listTrendRows).toHaveBeenCalledTimes(1);
    expect(repo.listTrendRowsLocalDays).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      bucketZone: "UTC",
      userZone: "Mars/Olympus",
      zoneFallbackReason: "unsupported",
    });
  });

  it("Node 认、库不认 → 'unsupported'(双重校验缺一不可)", async () => {
    const { repo, service } = makeService({ knownInDb: false });
    const res = await service.getUsageTrend({
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "day",
      span: 30,
      zone: "Asia/Shanghai",
    });
    expect(repo.isKnownTimeZone).toHaveBeenCalledWith("Asia/Shanghai");
    expect(repo.listTrendRows).toHaveBeenCalledTimes(1);
    expect(res.zoneFallbackReason).toBe("unsupported");
  });

  it("窗口超过 35 天 → UTC 日表 + 'retention'", async () => {
    const { repo, service } = makeService();
    const res = await service.getUsageTrend({
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "day",
      span: 90,
      zone: "Asia/Shanghai",
    });
    expect(repo.listTrendRows).toHaveBeenCalledTimes(1);
    expect(repo.listTrendRowsLocalDays).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      bucketZone: "UTC",
      userZone: "Asia/Shanghai",
      zoneFallbackReason: "retention",
    });
  });

  it("week 档 + 合法用户时区 → UTC 权威表 + 'granularity'(校验照做,一样问库一次)", async () => {
    const { repo, service } = makeService();
    const res = await service.getUsageTrend({
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "week",
      span: 12,
      zone: "Asia/Shanghai",
    });
    expect(repo.isKnownTimeZone).toHaveBeenCalledTimes(1);
    expect(repo.listTrendRows).toHaveBeenCalledTimes(1);
    expect(repo.listTrendRowsLocalDays).not.toHaveBeenCalled();
    expect(res.zoneFallbackReason).toBe("granularity");
    expect(res.bucketZone).toBe("UTC");
  });

  it("hour 档 + Node 认不出的名 → 'unsupported'(不是 'granularity'),且不问库", async () => {
    const { repo, service } = makeService();
    const res = await service.getUsageTrend({
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "hour",
      span: 24,
      zone: "Beijing",
    });
    expect(repo.isKnownTimeZone).not.toHaveBeenCalled();
    expect(repo.listTrendRows).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({
      bucketZone: "UTC",
      userZone: "Beijing",
      zoneFallbackReason: "unsupported",
    });
  });

  it("hour 档 + Node 认、库不认 → 'unsupported'(双重校验对每个档位都成立)", async () => {
    const { repo, service } = makeService({ knownInDb: false });
    const res = await service.getUsageTrend({
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "hour",
      span: 24,
      zone: "Asia/Shanghai",
    });
    expect(repo.isKnownTimeZone).toHaveBeenCalledWith("Asia/Shanghai");
    expect(res.zoneFallbackReason).toBe("unsupported");
  });

  it("pg_timezone_names 的结果按进程缓存一小时", async () => {
    const { repo, service } = makeService();
    const q = {
      workspaceId: WS,
      metric: "ai.credit",
      granularity: "day" as const,
      span: 7,
      zone: "Europe/Berlin",
    };
    const t0 = new Date("2026-09-04T01:30:00Z");
    await service.getUsageTrend(q, t0);
    await service.getUsageTrend(q, new Date(t0.getTime() + 1000));
    expect(repo.isKnownTimeZone).toHaveBeenCalledTimes(1);
    await service.getUsageTrend(
      q,
      new Date(t0.getTime() + ZONE_CHECK_TTL_MS + 1),
    );
    expect(repo.isKnownTimeZone).toHaveBeenCalledTimes(2);
  });
});
