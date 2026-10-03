import { Inject, Injectable } from "@nestjs/common";
import { isIanaTimeZone } from "@vxture-platform/shared";
import { PgMeteringReadRepository } from "../repository/pg-metering-read.repository";
import type {
  QuotaOverviewRows,
  UsageEventsQuery,
  UsageEventsResult,
  UsageGranularity,
  UsageMemberRow,
  UsageTrendQuery,
  UsageTrendResult,
  UsageZoneFallbackReason,
} from "../types/metering-read.types";
import {
  REBUCKET_HORIZON_DAYS,
  usagePeriodKeys,
  usageWindowEndExclusive,
  usageWindowStart,
  zeroFillBuckets,
} from "./usage-periods";

/** 桶时区的裁决:按谁的时区切、没按用户时区时的原因。 */
export interface BucketZoneDecision {
  bucketZone: string;
  reason: UsageZoneFallbackReason | null;
}

/**
 * 桶时区裁决(纯函数,owner 裁定 4 2026-10-04:「默认按照 UTC+0,如果用户设置了,
 * 按照用户设置时区」)。顺序就是优先级:
 *
 *   granularity ∉ {day}          → UTC;用户设了非 UTC 时区时标 'granularity'(周/月/年
 *                                   保持 UTC 权威,hour 桶与时区无关)
 *   userZone 空 / 'UTC'          → UTC,无原因(没设 = 默认;设的就是 UTC = 已按用户时区)
 *   !zoneIsValid                 → UTC,'unsupported'(Node 或 PG 认不出这个名)
 *   span > REBUCKET_HORIZON_DAYS → UTC,'retention'(超过小时表可重切的天数,只能回 UTC 日表)
 *   其余                          → 用户时区
 *
 * 'unsupported' 排在 'retention' 前面:时区本身坏了比窗口太长更该先告诉用户——前者要
 * 他去账号页重选,后者缩短窗口就好。
 */
export function resolveBucketZone(
  granularity: UsageGranularity,
  span: number,
  userZone: string | null,
  zoneIsValid: boolean,
): BucketZoneDecision {
  const wantsZone = userZone !== null && userZone !== "UTC";
  if (granularity !== "day") {
    return { bucketZone: "UTC", reason: wantsZone ? "granularity" : null };
  }
  if (!wantsZone) return { bucketZone: "UTC", reason: null };
  if (!zoneIsValid) return { bucketZone: "UTC", reason: "unsupported" };
  if (span > REBUCKET_HORIZON_DAYS) {
    return { bucketZone: "UTC", reason: "retention" };
  }
  return { bucketZone: userZone, reason: null };
}

/** pg_timezone_names 查过的名字按进程缓存多久(tzdata 不会在一个进程里变)。 */
export const ZONE_CHECK_TTL_MS = 60 * 60 * 1000;

/**
 * 计量读侧服务(配额总览 / 用量分析)。console 批 3:从 console-bff 的 quota /
 * usage router 下沉——BFF 只做权限门与视图映射。趋势按周期键补零;桶边界 UTC,
 * 只有 day 档在用户设了时区且窗口不超过 REBUCKET_HORIZON_DAYS 时按用户时区重切。
 */
@Injectable()
export class MeteringReadService {
  /** zone → { PG 认不认, 查的时刻 }。不每请求查 pg_timezone_names。 */
  private readonly zoneChecks = new Map<string, { ok: boolean; at: number }>();

  constructor(
    // Explicit token: esbuild does not emit design:paramtypes metadata into the
    // BFF bundle (与 BillingService 同一理由)。
    @Inject(PgMeteringReadRepository)
    private readonly repo: PgMeteringReadRepository,
  ) {}

  findDefaultWorkspaceId(tenantId: string): Promise<string | null> {
    return this.repo.findDefaultWorkspaceId(tenantId);
  }

  /** 配额总览三路一次往返(池 / 水位切片 / 共享策略)。 */
  async getQuotaOverviewRows(workspaceId: string): Promise<QuotaOverviewRows> {
    const [pools, gauges, sharing] = await Promise.all([
      this.repo.listActivePools(workspaceId),
      this.repo.listGauges(workspaceId),
      this.repo.listSharingPolicies(workspaceId),
    ]);
    return { pools, gauges, sharing };
  }

  /**
   * 双重校验:Node 的 Intl 列表 + PostgreSQL 的 pg_timezone_names,两边都认才用。
   * 两份 tzdata 可能不同步;只认一边就会在另一边炸(PG 对无效名是错误,不是空结果)。
   */
  private async zoneIsValid(zone: string, nowMs: number): Promise<boolean> {
    if (!isIanaTimeZone(zone)) return false;
    const hit = this.zoneChecks.get(zone);
    if (hit && nowMs - hit.at < ZONE_CHECK_TTL_MS) return hit.ok;
    const ok = await this.repo.isKnownTimeZone(zone);
    this.zoneChecks.set(zone, { ok, at: nowMs });
    return ok;
  }

  /**
   * 周期趋势:窗口内每个周期都有一桶(无数据补零),末桶 = 当前周期。
   * `now` 可注入,方便测试。
   *
   * 桶时区由 resolveBucketZone 裁决;只有裁决为用户时区时才走小时表重切
   * (listTrendRowsLocalDays),其余一律读各档 UTC 权威表(listTrendRows)。
   */
  async getUsageTrend(
    query: UsageTrendQuery,
    now: Date = new Date(),
  ): Promise<UsageTrendResult> {
    const userZone = query.zone?.trim() || null;
    const wantsZone =
      query.granularity === "day" && userZone !== null && userZone !== "UTC";
    const valid = wantsZone
      ? await this.zoneIsValid(userZone, now.getTime())
      : false;
    const { bucketZone, reason } = resolveBucketZone(
      query.granularity,
      query.span,
      userZone,
      valid,
    );
    const keys = usagePeriodKeys(
      query.granularity,
      query.span,
      now,
      bucketZone,
    );
    const rows =
      bucketZone === "UTC"
        ? await this.repo.listTrendRows({
            workspaceId: query.workspaceId,
            metric: query.metric,
            granularity: query.granularity,
            windowStart: usageWindowStart(query.granularity, keys[0]!),
          })
        : await this.repo.listTrendRowsLocalDays({
            workspaceId: query.workspaceId,
            metric: query.metric,
            zone: bucketZone,
            fromDay: keys[0]!,
            toDayExclusive: usageWindowEndExclusive(keys[keys.length - 1]!),
          });
    return {
      metric: query.metric,
      granularity: query.granularity,
      bucketZone,
      userZone,
      zoneFallbackReason: reason,
      buckets: zeroFillBuckets(keys, rows),
    };
  }

  /**
   * 调用记录:一页明细 + **筛选后全集**的条数与实扣量合计。
   *
   * 两条查询并发发出——它们读同一份谓词、互不依赖,串行只是白等一个 RTT。
   * 合计不随分页变,客户能直接拿它跟配额页、账单对数。
   */
  async listUsageEvents(query: UsageEventsQuery): Promise<UsageEventsResult> {
    const [items, totals] = await Promise.all([
      this.repo.listUsageEvents(query),
      this.repo.countUsageEvents(query),
    ]);
    return {
      items,
      total: totals.total,
      totalAmount: totals.totalAmount,
      offset: query.offset,
      limit: query.limit,
    };
  }

  listUsageByMember(input: {
    workspaceId: string;
    metric: string;
    days: number;
  }): Promise<UsageMemberRow[]> {
    return this.repo.listUsageByMember(input);
  }
}
