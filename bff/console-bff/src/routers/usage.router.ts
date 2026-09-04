/**
 * usage.router.ts - 租户用量分析路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 用量分析页(/usage,owner 2026-08-20 用量配额线)的读侧:
 *   GET /api/usage/trend   — 周期趋势(usage_summary_* 五档降采样,纯统计/
 *                            看板,永不作计费依据):granularity=hour|day|week|
 *                            month|year × span,含按产品拆分;窗口内每个周期
 *                            都有一桶(无数据补零),末桶 = 当前周期,全程 UTC;
 *   GET /api/usage/events  — 任务级调用记录(usage_events,每次 consume 一行,
 *                            含终端用户归因;NULL = 未归集用户容错桶),带硬顶
 *                            与是否截断;
 *   GET /api/usage/members — 商业版按成员统计(近 N 天 usage_events 按
 *                            end_user_id 聚合,未归集单列一桶)。
 *
 * SQL 归 @vxture/service-subscription 的 MeteringReadService(console 批 3
 * 下沉);这里只做参数收口与视图映射。全页无 UUID 出口——事件行以 request_id/
 * 时间定位,成员以显示名呈现。
 */

import {
  Controller,
  BadRequestException,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  MeteringReadService,
  type UsageGranularity,
} from "@vxture/service-subscription";
import type { RequestContext } from "../types/console.types";
import { RequireCapability } from "../auth/capability";

// ============================================================================
// View types (mirrored by portals/console/src/api/console-bff.ts)
// ============================================================================

export interface UsageTrendBucket {
  /**
   * UTC 桶键:hour `YYYY-MM-DD HH:00` / day `YYYY-MM-DD` / week `YYYY-MM-DD`
   * (ISO 周一)/ month `YYYYMM` / year `YYYY`
   */
  period: string;
  total: number;
  byProduct: { productCode: string; productName: string; total: number }[];
}

export interface UsageTrendView {
  metric: string;
  granularity: string;
  buckets: UsageTrendBucket[];
}

export interface UsageEventView {
  /** 事件时间(ISO) */
  at: string;
  productCode: string;
  productName: string;
  metric: string;
  amount: number;
  /** 终端用户显示名;null = 产品未归集(容错桶) */
  userName: string | null;
  requestId: string | null;
}

/** 调用记录 + 硬顶说明:满额即可能被截断,页面据此提示。 */
export interface UsageEventsView {
  items: UsageEventView[];
  days: number;
  limit: number;
  truncated: boolean;
}

export interface UsageMemberView {
  /** null = 未归集桶 */
  userName: string | null;
  total: number;
  eventCount: number;
  lastAt: string;
}

const GRANULARITIES = new Set<UsageGranularity>([
  "hour",
  "day",
  "week",
  "month",
  "year",
]);

/** 每档默认/最大跨度(桶数)。hour = 近 24 小时逐时(柱状图,2026-08-21)。 */
const SPAN_LIMITS: Record<UsageGranularity, { def: number; max: number }> = {
  hour: { def: 24, max: 48 },
  day: { def: 30, max: 90 },
  week: { def: 12, max: 26 },
  month: { def: 12, max: 24 },
  year: { def: 5, max: 10 },
};

const EVENTS_DAYS = 90;
const EVENTS_DEFAULT_LIMIT = 200;
const EVENTS_MAX_LIMIT = 500;

const METRIC_RE = /^[a-z][a-z0-9_.\-]{0,63}$/;

function parseMetric(raw: string | undefined): string {
  return METRIC_RE.test(raw ?? "") ? raw! : "ai.credit";
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

// ============================================================================
// UsageRouter
// ============================================================================

@RequireCapability("tenant.quota.read")
@Controller("api/usage")
export class UsageRouter {
  constructor(
    @Inject(MeteringReadService)
    private readonly metering: MeteringReadService,
  ) {}

  // --------------------------------------------------------------------------
  // GET /api/usage/trend?metric=ai.credit&granularity=day&span=30
  // --------------------------------------------------------------------------

  @Get("trend")
  async getTrend(
    @Req() req: Request & RequestContext,
    @Query("metric") metricRaw?: string,
    @Query("granularity") granularityRaw?: string,
    @Query("span") spanRaw?: string,
  ): Promise<UsageTrendView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);

    const granularity: UsageGranularity = GRANULARITIES.has(
      granularityRaw as UsageGranularity,
    )
      ? (granularityRaw as UsageGranularity)
      : "day";
    const limits = SPAN_LIMITS[granularity];
    const result = await this.metering.getUsageTrend({
      workspaceId,
      metric: parseMetric(metricRaw),
      granularity,
      span: parsePositiveInt(spanRaw, limits.def, limits.max),
    });
    return {
      metric: result.metric,
      granularity: result.granularity,
      buckets: result.buckets,
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/usage/events?limit=200 — 任务级调用记录(近 90 天,时间倒序)
  // --------------------------------------------------------------------------

  @Get("events")
  async getEvents(
    @Req() req: Request & RequestContext,
    @Query("limit") limitRaw?: string,
  ): Promise<UsageEventsView> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const result = await this.metering.listUsageEvents({
      workspaceId,
      days: EVENTS_DAYS,
      limit: parsePositiveInt(limitRaw, EVENTS_DEFAULT_LIMIT, EVENTS_MAX_LIMIT),
    });
    return {
      items: result.items.map((r) => ({
        at: r.createdAt.toISOString(),
        productCode: r.productCode,
        productName: r.productName,
        metric: r.metricKey,
        amount: r.totalAmount,
        userName: r.userName,
        requestId: r.requestId,
      })),
      days: result.days,
      limit: result.limit,
      truncated: result.truncated,
    };
  }

  // --------------------------------------------------------------------------
  // GET /api/usage/members?days=30 — 按成员统计(商业版细分;未归集单列一桶)
  // --------------------------------------------------------------------------

  @Get("members")
  async getMembers(
    @Req() req: Request & RequestContext,
    @Query("days") daysRaw?: string,
    @Query("metric") metricRaw?: string,
  ): Promise<UsageMemberView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const rows = await this.metering.listUsageByMember({
      workspaceId,
      metric: parseMetric(metricRaw),
      days: parsePositiveInt(daysRaw, 30, 365),
    });
    return rows.map((r) => ({
      userName: r.userName,
      total: r.total,
      eventCount: r.eventCount,
      lastAt: r.lastAt.toISOString(),
    }));
  }

  private async resolveDefaultWorkspace(tenantId: string): Promise<string> {
    const id = await this.metering.findDefaultWorkspaceId(tenantId);
    if (!id) throw new BadRequestException("租户缺少默认工作空间");
    return id;
  }
}
