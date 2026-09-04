import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  QuotaPoolRow,
  SharingPolicyRow,
  UsageEventRow,
  UsageGaugeRow,
  UsageGranularity,
  UsageMemberRow,
} from "../types/metering-read.types";

/**
 * 计量读侧仓储(配额总览 / 用量分析;console 批 3 从 console-bff 下沉)。
 * 只读 SELECT;写一律走 consume / addon 服务。所有周期口径 UTC,与 rollup /
 * consume 的周期逻辑一致。
 */
@Injectable()
export class PgMeteringReadRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  /** 租户默认工作空间;缺失返回 null(开租户时一并建,理论上不存在)。 */
  async findDefaultWorkspaceId(tenantId: string): Promise<string | null> {
    const res = await this.pool.query<{ id: string }>(
      `select id from tenancy.workspaces
        where tenant_id = $1 and is_default and deleted_at is null
        limit 1`,
      [tenantId],
    );
    return res.rows[0]?.id ?? null;
  }

  /**
   * 活跃可用池(与 consume/C2 同门:活跃、未过期、订阅池须订阅 live——D10)。
   * effective_used = 懒重置周期感知视图(周期翻篇按 0 计,只读不落库,归零
   * 仍归 consume 写路径),UTC 口径与引擎 needsReset 一致。
   */
  async listActivePools(workspaceId: string): Promise<QuotaPoolRow[]> {
    const res = await this.pool.query<{
      metric_key: string;
      pool_source: string;
      product_code: string | null;
      product_name: string | null;
      quota_limit: string;
      effective_used: string;
      reset_period: string;
      expires_at: Date | null;
      platform_kind: string | null;
    }>(
      `select qp.metric_key, qp.pool_source,
              prod.product_code, prod.product_name,
              qp.quota_limit::text as quota_limit,
              (case
                 when qp.reset_period = 'day'
                      and qp.current_period_start is not null
                      and date_trunc('day', qp.current_period_start at time zone 'UTC')
                          <> date_trunc('day', now() at time zone 'UTC') then 0
                 when qp.reset_period = 'month'
                      and qp.current_period_start is not null
                      and date_trunc('month', qp.current_period_start at time zone 'UTC')
                          <> date_trunc('month', now() at time zone 'UTC') then 0
                 else qp.quota_used
               end)::text as effective_used,
              qp.reset_period, qp.expires_at,
              plm.kind as platform_kind
         from metering.quota_pools qp
         left join product.products prod on prod.id = qp.product_id
         left join product.platform_metrics plm on plm.metric_key = qp.metric_key
        where qp.workspace_id = $1
          and qp.status = 'active'
          and (qp.expires_at is null or qp.expires_at > now())
          and (qp.subscription_id is null or exists (
                 select 1 from metering.subscriptions ts
                  where ts.id = qp.subscription_id
                    and ts.status in ('active', 'trialing')
                    and ts.deleted_at is null))
        order by qp.metric_key asc, qp.priority asc, qp.effective_at asc`,
      [workspaceId],
    );
    return res.rows.map((r) => ({
      metricKey: r.metric_key,
      poolSource: r.pool_source,
      productCode: r.product_code,
      productName: r.product_name,
      quotaLimit: Number(r.quota_limit),
      effectiveUsed: Number(r.effective_used),
      resetPeriod: r.reset_period,
      expiresAt: r.expires_at,
      platformKind: r.platform_kind,
    }));
  }

  /** 各产品最新水位切片(usage_gauges,LWW 快照)。 */
  async listGauges(workspaceId: string): Promise<UsageGaugeRow[]> {
    const res = await this.pool.query<{
      metric_key: string;
      product_code: string;
      product_name: string;
      value: string;
      observed_at: Date;
    }>(
      `select ug.metric_key, prod.product_code, prod.product_name,
              ug.value::text as value, ug.observed_at
         from metering.usage_gauges ug
         join product.products prod on prod.id = ug.product_id
        where ug.workspace_id = $1
        order by prod.product_code asc`,
      [workspaceId],
    );
    return res.rows.map((r) => ({
      metricKey: r.metric_key,
      productCode: r.product_code,
      productName: r.product_name,
      value: Number(r.value),
      observedAt: r.observed_at,
    }));
  }

  /** 共享策略参与行(空 = 全保留,product_220 §4.3 安全默认)。 */
  async listSharingPolicies(workspaceId: string): Promise<SharingPolicyRow[]> {
    const res = await this.pool.query<{
      metric_key: string;
      product_code: string;
      product_name: string;
    }>(
      `select rsp.metric_key, prod.product_code, prod.product_name
         from metering.resource_sharing_policies rsp
         join product.products prod on prod.id = rsp.product_id
        where rsp.workspace_id = $1
        order by prod.product_code asc`,
      [workspaceId],
    );
    return res.rows.map((r) => ({
      metricKey: r.metric_key,
      productCode: r.product_code,
      productName: r.product_name,
    }));
  }

  /**
   * 趋势原始行(稀疏:只有有数据的 (period, product) 组合)。窗口起点由调用方
   * 按周期键算好绑进来(UTC),不在 SQL 里做 now() - interval——两边口径要一致。
   * period 文本化与周期键同形:hour `YYYY-MM-DD HH:00`、day / week `YYYY-MM-DD`、
   * month `YYYYMM`、year `YYYY`。
   */
  async listTrendRows(input: {
    workspaceId: string;
    metric: string;
    granularity: UsageGranularity;
    windowStart: string;
  }): Promise<
    {
      period: string;
      productCode: string;
      productName: string;
      total: number;
    }[]
  > {
    const table = TREND_TABLE[input.granularity];
    const periodExpr = TREND_PERIOD_EXPR[input.granularity];
    const windowPred = TREND_WINDOW_PRED[input.granularity];
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
      [input.workspaceId, input.metric, input.windowStart],
    );
    return res.rows.map((r) => ({
      period: r.period,
      productCode: r.product_code,
      productName: r.product_name,
      total: Number(r.total),
    }));
  }

  /**
   * 任务级调用记录(时间倒序)。created_at 窗口谓词裁剪月分区;end_user_id 裸
   * UUID → account 解引用(边界#2 的读侧解引用,与订单页 subscriber_name 同法)。
   */
  async listUsageEvents(input: {
    workspaceId: string;
    days: number;
    limit: number;
  }): Promise<UsageEventRow[]> {
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
          and e.created_at >= now() - make_interval(days => $2)
        order by e.created_at desc
        limit $3`,
      [input.workspaceId, input.days, input.limit],
    );
    return res.rows.map((r) => ({
      createdAt: r.created_at,
      productCode: r.product_code,
      productName: r.product_name,
      metricKey: r.metric_key,
      totalAmount: Number(r.total_amount),
      userName: r.user_name,
      requestId: r.request_id,
    }));
  }

  /** 按成员统计(近 N 天 usage_events 按 end_user_id 聚合,未归集单列一桶)。 */
  async listUsageByMember(input: {
    workspaceId: string;
    metric: string;
    days: number;
  }): Promise<UsageMemberRow[]> {
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
      [input.workspaceId, input.metric, input.days],
    );
    return res.rows.map((r) => ({
      userName: r.user_name,
      total: Number(r.total),
      eventCount: Number(r.event_count),
      lastAt: r.last_at,
    }));
  }
}

const TREND_TABLE: Record<UsageGranularity, string> = {
  hour: "usage_summary_hours",
  day: "usage_summary_days",
  week: "usage_summary_weeks",
  month: "usage_summary_months",
  year: "usage_summary_years",
};

const TREND_PERIOD_EXPR: Record<UsageGranularity, string> = {
  hour: "to_char(s.period_hour at time zone 'UTC', 'YYYY-MM-DD HH24:00')",
  day: "to_char(s.period_day, 'YYYY-MM-DD')",
  week: "to_char(s.period_week, 'YYYY-MM-DD')",
  month: "s.period_month",
  year: "s.period_year",
};

/** 窗口谓词:$3 = 首桶键(hour 为 ISO 时刻,day / week 为日期,month / year 为文本)。 */
const TREND_WINDOW_PRED: Record<UsageGranularity, string> = {
  hour: "s.period_hour >= $3::timestamptz",
  day: "s.period_day >= $3::date",
  week: "s.period_week >= $3::date",
  month: "s.period_month >= $3::text",
  year: "s.period_year >= $3::text",
};
