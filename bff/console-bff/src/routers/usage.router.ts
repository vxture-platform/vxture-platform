/**
 * usage.router.ts - 租户用量分析路由
 * @package @vxture/bff-console
 * @layer Application
 * @category Router
 *
 * 用量分析页(/usage,owner 2026-08-20 用量配额线)的读侧:
 *   GET /api/usage/trend   — 周期趋势(usage_summary_* 五档降采样,纯统计/
 *                            看板,永不作计费依据):granularity=day|week|
 *                            month|year × span,含按产品拆分;
 *   GET /api/usage/events  — 任务级调用记录(usage_events,每次 consume 一行,
 *                            含终端用户归因;NULL = 未归集用户容错桶);
 *   GET /api/usage/members — 商业版按成员统计(近 N 天 usage_events 按
 *                            end_user_id 聚合,未归集单列一桶)。
 *
 * 只读直查(console-bff 约定);全页无 UUID 出口——事件行以 request_id/时间
 * 定位,成员以显示名呈现。
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
import type { Pool } from "pg";
import type { RequestContext } from "../types/console.types";
import { RequireCapability } from "../auth/capability";

// Inline the DI token (repo-wide pattern): SubscriptionModule provides the pool.
const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

// ============================================================================
// View types (mirrored by portals/console/src/api/console-bff.ts)
// ============================================================================

export interface UsageTrendBucket {
  /** day: YYYY-MM-DD / week: YYYY-MM-DD(ISO 周一) / month: YYYYMM / year: YYYY */
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

export interface UsageMemberView {
  /** null = 未归集桶 */
  userName: string | null;
  total: number;
  eventCount: number;
  lastAt: string;
}

const GRANULARITIES = new Set(["hour", "day", "week", "month", "year"]);

/** 每档默认/最大跨度(桶数)。hour = 近 24 小时逐时(柱状图,2026-08-21)。 */
const SPAN_LIMITS: Record<string, { def: number; max: number }> = {
  hour: { def: 24, max: 48 },
  day: { def: 30, max: 90 },
  week: { def: 12, max: 26 },
  month: { def: 12, max: 24 },
  year: { def: 5, max: 10 },
};

// ============================================================================
// UsageRouter
// ============================================================================

@RequireCapability("tenant.quota.read")
@Controller("api/usage")
export class UsageRouter {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

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

    const metric = /^[a-z][a-z0-9_.\-]{0,63}$/.test(metricRaw ?? "")
      ? metricRaw!
      : "ai.credit";
    const granularity = GRANULARITIES.has(granularityRaw ?? "")
      ? granularityRaw!
      : "day";
    const limits = SPAN_LIMITS[granularity]!;
    const spanNum = Number(spanRaw);
    const span =
      Number.isInteger(spanNum) && spanNum >= 1
        ? Math.min(spanNum, limits.max)
        : limits.def;

    // 每档一张表、一种 period 列;period 统一 text 化返回,窗口按档推算。
    const table = {
      hour: "usage_summary_hours",
      day: "usage_summary_days",
      week: "usage_summary_weeks",
      month: "usage_summary_months",
      year: "usage_summary_years",
    }[granularity]!;
    const periodExpr = {
      // hour 带全日期保证排序正确;展示端截取 HH:00
      hour: "to_char(s.period_hour at time zone 'UTC', 'YYYY-MM-DD HH24:00')",
      day: "to_char(s.period_day, 'YYYY-MM-DD')",
      week: "to_char(s.period_week, 'YYYY-MM-DD')",
      month: "s.period_month",
      year: "s.period_year",
    }[granularity]!;
    const windowPred = {
      hour: `s.period_hour >= date_trunc('hour', now()) - make_interval(hours => $3)`,
      day: `s.period_day >= (now() at time zone 'UTC')::date - make_interval(days => $3)`,
      week: `s.period_week >= date_trunc('week', (now() at time zone 'UTC')::date)::date - make_interval(weeks => $3)`,
      month: `s.period_month >= to_char((now() at time zone 'UTC')::date - make_interval(months => $3), 'YYYYMM')`,
      year: `s.period_year >= to_char((now() at time zone 'UTC')::date - make_interval(years => $3), 'YYYY')`,
    }[granularity]!;

    const res = await this.pool.query<{
      period: string;
      product_code: string;
      product_name: string;
      total: string;
    }>(
      `select ${periodExpr} as period, prod.product_code, prod.product_name,
              sum(s.total_amount)::text as total
         from metering.${table} s
         join product.products prod on prod.id = s.product_id
        where s.workspace_id = $1
          and s.metric_key = $2
          and ${windowPred}
        group by 1, 2, 3
        order by 1 asc, 2 asc`,
      [workspaceId, metric, span],
    );

    const byPeriod = new Map<string, UsageTrendBucket>();
    for (const r of res.rows) {
      let bucket = byPeriod.get(r.period);
      if (!bucket) {
        bucket = { period: r.period, total: 0, byProduct: [] };
        byPeriod.set(r.period, bucket);
      }
      const total = Number(r.total);
      bucket.total += total;
      bucket.byProduct.push({
        productCode: r.product_code,
        productName: r.product_name,
        total,
      });
    }
    return { metric, granularity, buckets: [...byPeriod.values()] };
  }

  // --------------------------------------------------------------------------
  // GET /api/usage/events?limit=200 — 任务级调用记录(近 90 天,时间倒序)
  // --------------------------------------------------------------------------

  @Get("events")
  async getEvents(
    @Req() req: Request & RequestContext,
    @Query("limit") limitRaw?: string,
  ): Promise<UsageEventView[]> {
    if (!req.tenant) throw new UnauthorizedException("租户上下文缺失");
    const workspaceId = await this.resolveDefaultWorkspace(req.tenant.id);
    const limitNum = Number(limitRaw);
    const limit =
      Number.isInteger(limitNum) && limitNum >= 1
        ? Math.min(limitNum, 500)
        : 200;

    // created_at 窗口谓词裁剪月分区;end_user_id 裸 UUID → account 解引用
    // (边界#2 的读侧解引用,与订单页 subscriber_name 同法)。
    const res = await this.pool.query<{
      created_at: Date;
      product_code: string;
      product_name: string;
      metric_key: string;
      total_amount: string;
      user_name: string | null;
      request_id: string | null;
    }>(
      `select e.created_at, prod.product_code, prod.product_name,
              e.metric_key, e.total_amount::text as total_amount,
              coalesce(up.display_name, u.account) as user_name,
              e.request_id
         from metering.usage_events e
         join product.products prod on prod.id = e.product_id
         left join account.users u on u.id = e.end_user_id
         left join account.user_profiles up on up.user_id = e.end_user_id
        where e.workspace_id = $1
          and e.created_at >= now() - interval '90 days'
        order by e.created_at desc
        limit $2`,
      [workspaceId, limit],
    );
    return res.rows.map((r) => ({
      at: r.created_at.toISOString(),
      productCode: r.product_code,
      productName: r.product_name,
      metric: r.metric_key,
      amount: Number(r.total_amount),
      userName: r.user_name,
      requestId: r.request_id,
    }));
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
    const daysNum = Number(daysRaw);
    const days =
      Number.isInteger(daysNum) && daysNum >= 1 ? Math.min(daysNum, 365) : 30;
    const metric = /^[a-z][a-z0-9_.\-]{0,63}$/.test(metricRaw ?? "")
      ? metricRaw!
      : "ai.credit";

    const res = await this.pool.query<{
      user_name: string | null;
      total: string;
      event_count: string;
      last_at: Date;
    }>(
      `select case when e.end_user_id is null then null
                   else coalesce(up.display_name, u.account) end as user_name,
              sum(e.total_amount)::text as total,
              count(*)::text as event_count,
              max(e.created_at) as last_at
         from metering.usage_events e
         left join account.users u on u.id = e.end_user_id
         left join account.user_profiles up on up.user_id = e.end_user_id
        where e.workspace_id = $1
          and e.metric_key = $2
          and e.created_at >= now() - make_interval(days => $3)
        group by e.end_user_id, 1
        order by sum(e.total_amount) desc`,
      [workspaceId, metric, days],
    );
    return res.rows.map((r) => ({
      userName: r.user_name,
      total: Number(r.total),
      eventCount: Number(r.event_count),
      lastAt: r.last_at.toISOString(),
    }));
  }

  private async resolveDefaultWorkspace(tenantId: string): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `select id from tenancy.workspaces
        where tenant_id = $1 and is_default and deleted_at is null
        limit 1`,
      [tenantId],
    );
    const id = res.rows[0]?.id;
    if (!id) throw new BadRequestException("租户缺少默认工作空间");
    return id;
  }
}
