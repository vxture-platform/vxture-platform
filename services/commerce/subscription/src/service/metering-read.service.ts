import { Inject, Injectable } from "@nestjs/common";
import { PgMeteringReadRepository } from "../repository/pg-metering-read.repository";
import type {
  QuotaOverviewRows,
  UsageEventsQuery,
  UsageEventsResult,
  UsageMemberRow,
  UsageTrendQuery,
  UsageTrendResult,
} from "../types/metering-read.types";
import {
  usagePeriodKeys,
  usageWindowStart,
  zeroFillBuckets,
} from "./usage-periods";

/**
 * 计量读侧服务(配额总览 / 用量分析)。console 批 3:从 console-bff 的 quota /
 * usage router 下沉——BFF 只做权限门与视图映射。趋势按周期键补零、全程 UTC。
 */
@Injectable()
export class MeteringReadService {
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
   * 周期趋势:窗口内每个周期都有一桶(无数据补零),末桶 = 当前周期(UTC)。
   * `now` 可注入,方便测试。
   */
  async getUsageTrend(
    query: UsageTrendQuery,
    now: Date = new Date(),
  ): Promise<UsageTrendResult> {
    const keys = usagePeriodKeys(query.granularity, query.span, now);
    const rows = await this.repo.listTrendRows({
      workspaceId: query.workspaceId,
      metric: query.metric,
      granularity: query.granularity,
      windowStart: usageWindowStart(query.granularity, keys[0]!),
    });
    return {
      metric: query.metric,
      granularity: query.granularity,
      buckets: zeroFillBuckets(keys, rows),
    };
  }

  /** 调用记录;满额即标 truncated,页面据此提示「只显示最近 N 条」。 */
  async listUsageEvents(query: UsageEventsQuery): Promise<UsageEventsResult> {
    const items = await this.repo.listUsageEvents(query);
    return {
      items,
      days: query.days,
      limit: query.limit,
      truncated: items.length >= query.limit,
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
