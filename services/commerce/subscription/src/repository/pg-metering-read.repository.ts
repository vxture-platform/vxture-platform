import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { needsQuotaReset } from "@vxture-platform/shared";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  UsageAnalyticsQuery,
  UsageAnalyticsResult,
  QuotaPoolRow,
  SharingPolicyRow,
  UsageEventRow,
  UsageGaugeRow,
  UsageGranularity,
  UsageMemberRow,
} from "../types/metering-read.types";

/* ── 调用记录的 FROM / WHERE:明细与合计**共用一份** ───────────────────────────
 *
 * 分成两条查询是为了让明细走 limit/offset、合计走聚合,各自选到合适的计划;
 * 但谓词必须是同一份,否则「明细逐条加起来 ≠ 表尾合计」——而这张表存在的理由
 * 恰恰是让客户自己加总对账,一旦对不上就适得其反。所以抽成常量,改一处两边同步。
 *
 * 参数位固定:$1 workspace / $2 from / $3 to / $4 product / $5 metric /
 * $6 user(可视码或 'unattributed')/ $7 requestId。明细查询在其后接 $8 limit、
 * $9 offset。
 */
const USAGE_EVENTS_FROM = `from metering.usage_events e
         join product.products prod on prod.id = e.product_id
         left join account.users u on u.id = e.end_user_id
         left join account.user_profiles up on up.user_id = e.end_user_id`;

const USAGE_EVENTS_WHERE = `e.workspace_id = $1
          and e.created_at >= $2 and e.created_at < $3
          and ($4::text is null or prod.product_code = $4)
          and ($5::text is null or e.metric_key = $5)
          and ($6::text is null
               or ($6 = 'unattributed' and e.end_user_id is null)
               or ($6 <> 'unattributed' and u.user_no::text = $6))
          and ($7::text is null or e.request_id = $7)`;

/** 两条查询共用的 $1..$7。 */
const usageEventsParams = (input: {
  workspaceId: string;
  from: Date;
  to: Date;
  productCode?: string;
  metricKey?: string;
  user?: string;
  requestId?: string;
}): unknown[] => [
  input.workspaceId,
  input.from,
  input.to,
  input.productCode ?? null,
  input.metricKey ?? null,
  input.user ?? null,
  input.requestId ?? null,
];

/**
 * 计量读侧仓储(配额总览 / 用量分析;console 批 3 从 console-bff 下沉)。
 * Read-only analytics and quota queries; writes belong to consume/addon services.
 * Legacy trend reads use UTC rollups with optional local-day re-bucketing.
 * Global analytics reads event facts at one snapshot and uses the account zone
 * for every natural-period window; it never changes the UTC rollup tables.
 */
@Injectable()
export class PgMeteringReadRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  // ============================================================================
  // Analytics snapshot
  // ============================================================================

  /**
   * Aggregate facts once; keep zero-usage subscriptions and workspace members.
   * A single statement gives all dimensions the same PostgreSQL snapshot.
   * @param input - Trusted workspace scope, natural period and fixed end time.
   * @returns Three distributions with their exact half-open time range.
   * @throws When the workspace does not belong to the authenticated tenant.
   */
  async readUsageAnalytics(
    input: UsageAnalyticsQuery & { zone: string; now: Date },
  ): Promise<
    Pick<
      UsageAnalyticsResult,
      "from" | "to" | "buckets" | "products" | "members"
    >
  > {
    const spans = { hour: 24, day: 30, week: 12, month: 12 } as const;
    const res = await this.pool.query<{
      from_at: Date;
      to_at: Date;
      buckets: UsageAnalyticsResult["buckets"];
      products: UsageAnalyticsResult["products"];
      members: UsageAnalyticsResult["members"];
    }>(
      `with scope as (
         select w.id from tenancy.workspaces w
          where w.id = $1 and w.tenant_id = $2 and w.deleted_at is null
       ), bounds as (
         select case when $4 = 'hour'
                then date_trunc('hour', $6::timestamptz, $5) - interval '23 hours'
                else (date_trunc($4, $6::timestamptz at time zone $5)
                 - ($7::int - 1) * ('1 ' || $4)::interval) at time zone $5 end as from_at,
                $6::timestamptz as to_at
           from scope
       ), facts as materialized (
         select e.product_id, e.end_user_id, e.total_amount, e.created_at,
                case when $4 = 'hour'
                     then date_bin(interval '1 hour', e.created_at, b.from_at) at time zone 'UTC'
                     else date_trunc($4, e.created_at at time zone $5) end as period
           from metering.usage_events e cross join bounds b
          where e.workspace_id = $1 and e.metric_key = $3
            and e.created_at >= b.from_at and e.created_at < b.to_at
       ), periods as (
         select generate_series(
           case when $4 = 'hour' then b.from_at at time zone 'UTC'
                else date_trunc($4, b.from_at at time zone $5) end,
           case when $4 = 'hour' then (b.from_at + interval '23 hours') at time zone 'UTC'
                else date_trunc($4, b.to_at at time zone $5) end,
           ('1 ' || $4)::interval) as period from bounds b
       ), time_usage as (
         select period, sum(total_amount) as total from facts group by period
       ), product_ids as (
         select product_id from facts
         union
         select pc.product_id from metering.subscriptions s
           join product.plan_components pc on pc.plan_version_id = s.plan_version_id
          where s.workspace_id = $1 and s.deleted_at is null
            and s.status in ('active','trialing','expiring','overdue')
       ), product_usage as (
         select product_id, sum(total_amount) as total from facts group by product_id
       ), member_ids as (
         select end_user_id as user_id from facts
         union
         select user_id from tenancy.workspace_memberships
          where workspace_id = $1 and status in ('active','suspended')
         union select null::uuid
       ), member_usage as (
         select end_user_id, sum(total_amount) as total, count(*) as event_count
           from facts group by end_user_id
       ), members as (
         select u.user_no::text as user_no,
                case when u.id is null then null else coalesce(up.display_name, u.account) end as user_name,
                sum(coalesce(mu.total, 0)) as total,
                sum(coalesce(mu.event_count, 0)) as event_count
           from member_ids mi
           left join member_usage mu on mu.end_user_id is not distinct from mi.user_id
           left join account.users u on u.id = mi.user_id
           left join account.user_profiles up on up.user_id = mi.user_id
          group by 1, 2
       )
       select b.from_at, b.to_at,
         (select coalesce(jsonb_agg(jsonb_build_object(
           'period', to_char(p.period, 'YYYY-MM-DD HH24:MI'),
           'total', coalesce(t.total, 0)) order by p.period), '[]'::jsonb)
          from periods p left join time_usage t using (period)) as buckets,
         (select coalesce(jsonb_agg(jsonb_build_object(
           'productCode', p.product_code, 'productName', p.product_name,
           'total', coalesce(pu.total, 0)) order by coalesce(pu.total, 0) desc, p.product_code), '[]'::jsonb)
          from product_ids pi join product.products p on p.id = pi.product_id
          left join product_usage pu on pu.product_id = pi.product_id
          where p.layer in ('L2', 'L3')) as products,
         (select coalesce(jsonb_agg(jsonb_build_object(
           'userNo', user_no, 'userName', user_name, 'total', total,
           'eventCount', event_count) order by total desc, user_no nulls last), '[]'::jsonb)
          from members) as members
       from bounds b`,
      [
        input.workspaceId,
        input.tenantId,
        input.metric,
        input.window,
        input.zone,
        input.now,
        spans[input.window],
      ],
    );
    const row = res.rows[0];
    if (!row) throw new Error("Usage workspace scope is unavailable");
    return {
      from: row.from_at.toISOString(),
      to: row.to_at.toISOString(),
      buckets: row.buckets,
      products: row.products,
      members: row.members,
    };
  }

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
   * effective_used = 懒重置周期感知视图(周期翻篇按 0 计,只读不落库,归零仍归 consume
   * 写路径)。
   *
   * **判据不在 SQL 里算**（2026-09-26 收口）：此前这里有一段 `date_trunc` 的 case 表达式,
   * 与 consume 写路径、platform-api 读时投影各写各的,三份都按日历月。改铁律五时一处改了
   * 另两处不报错——只会让同一个池在三个接口上显示三个余量。现在查原值,由
   * `@shared` 的 `needsQuotaReset` 统一判,算式全仓只此一份。
   */
  async listActivePools(workspaceId: string): Promise<QuotaPoolRow[]> {
    const res = await this.pool.query<{
      metric_key: string;
      pool_source: string;
      product_code: string | null;
      product_name: string | null;
      quota_limit: string;
      quota_used: string;
      current_period_start: Date | null;
      period_anchor: Date | null;
      reset_period: string;
      expires_at: Date | null;
      platform_kind: string | null;
      grant_reason: string | null;
      effective_at: Date | null;
    }>(
      `select qp.metric_key, qp.pool_source,
              prod.product_code, prod.product_name,
              qp.quota_limit::text as quota_limit,
              qp.quota_used::text as quota_used,
              qp.current_period_start, qp.period_anchor,
              qp.reset_period,
              least(qp.expires_at, sub.end_at, case when sub.subscription_kind = 'trial'
                then sub.trial_end_at end) as expires_at,
              qp.grant_reason, qp.effective_at,
              plm.kind as platform_kind
         from metering.quota_pools qp
         left join metering.subscriptions sub on sub.id = qp.subscription_id
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
    const now = new Date();
    return res.rows.map((r) => ({
      metricKey: r.metric_key,
      poolSource: r.pool_source,
      productCode: r.product_code,
      productName: r.product_name,
      quotaLimit: Number(r.quota_limit),
      /* 周期翻篇了就按 0 读——库里的 quota_used 要等下一次消费才归零（懒重置）。 */
      effectiveUsed: needsQuotaReset({
        resetPeriod: r.reset_period,
        periodAnchor: r.period_anchor,
        currentPeriodStart: r.current_period_start,
        now,
      })
        ? 0
        : Number(r.quota_used),
      resetPeriod: r.reset_period,
      expiresAt: r.expires_at,
      platformKind: r.platform_kind,
      grantReason: r.grant_reason,
      effectiveAt: r.effective_at,
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
   * day 档按用户时区重切(裁定 4):从**小时表**按 `zone` 把每个小时桶归到它起点
   * 所在的本地日,窗口 `[fromDay, toDayExclusive)` 两端各自在用户时区转成 timestamptz,
   * DST 切换日自然得到 23 / 25 小时。天表不读、不改——它是 workspace 级共享的 UTC 权威,
   * 而时区是 user 级设置,同一空间的成员可以各设各的。
   *
   * 与会话 TimeZone 无关:所有转换都显式带 `$4`;真库探针在 SET LOCAL TIME ZONE
   * 'Asia/Shanghai' 的会话里跑过,结果不变。
   *
   * 已知近似:小时桶按**起点瞬时**归日,对 +05:30 / +05:45 / +09:30 这类非整点时区,
   * 本地日实际从真正的本地 0 点**之后**半小时才开始:Kolkata 的 18:00Z 桶起点是 23:30 IST,
   * 归前一天,所以本地日从 19:00Z(00:30 IST)起算,而非 18:30Z(实测每天仍 24;窗口两端
   * `>= 18:30Z` 把首日前的 18:00Z 桶排除、`< 18:30Z` 把末日的 18:00Z 桶收进来,口径自洽)。
   * 半小时时区的 DST 日也按整桶取整(Lord Howe 24.5 小时的那天算 25 桶)。
   * 精确只能回 usage_events 重切,那是计费级表、90 天分区,不值。
   *
   * `zone` 必须先过 isIanaTimeZone + isKnownTimeZone:无效名在 PostgreSQL 是错误
   * (`time zone "Mars/Olympus" not recognized`),这里不 try/catch——吞掉它等于把
   * UTC 日贴上用户时区的标签。
   */
  async listTrendRowsLocalDays(input: {
    workspaceId: string;
    metric: string;
    /** 已校验的 IANA 名 */
    zone: string;
    /** 首桶键 `YYYY-MM-DD`(用户时区里的本地日) */
    fromDay: string;
    /** 末桶键的次日 `YYYY-MM-DD`(开区间右端) */
    toDayExclusive: string;
  }): Promise<
    {
      period: string;
      productCode: string;
      productName: string;
      total: number;
    }[]
  > {
    const res = await this.pool.query<{
      period: string;
      product_code: string;
      product_name: string;
      total: string;
    }>(
      `select to_char(s.period_hour at time zone $4, 'YYYY-MM-DD') as period,
              prod.product_code, prod.product_name,
              sum(s.total_amount)::text as total
         from metering.usage_summary_hours s
         join product.products prod on prod.id = s.product_id
        where s.workspace_id = $1
          and s.metric_key = $2
          and s.period_hour >= ($3::date::timestamp at time zone $4)
          and s.period_hour <  ($5::date::timestamp at time zone $4)
        group by 1, 2, 3
        order by 1 asc, 2 asc`,
      [
        input.workspaceId,
        input.metric,
        input.fromDay,
        input.zone,
        input.toDayExclusive,
      ],
    );
    return res.rows.map((r) => ({
      period: r.period,
      productCode: r.product_code,
      productName: r.product_name,
      total: Number(r.total),
    }));
  }

  /**
   * PostgreSQL 认不认这个时区名(pg_timezone_names,单名查找 ≈ 20 ms)。Node 的
   * Intl 列表与 PG 的 tzdata 可能不同步,两边都认才拿去重切;调用方按进程缓存结果。
   */
  async isKnownTimeZone(zone: string): Promise<boolean> {
    const res = await this.pool.query<{ ok: number }>(
      `select 1 as ok from pg_timezone_names where name = $1`,
      [zone],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * 任务级调用记录(时间倒序,可筛可翻页)。`created_at` 窗口谓词裁剪月分区;
   * `end_user_id` 裸 UUID → account 解引用(边界#2 的读侧解引用,与订单页
   * subscriber_name 同法),出口只给 `user_no` 可视码,不给 UUID。
   *
   * 筛选条件全部写成 `$n is null or <谓词>` 的形式:一条 SQL 覆盖所有组合,
   * 不拼字符串(拼串是注入面,也让 plan 缓存失效)。
   */
  async listUsageEvents(input: {
    workspaceId: string;
    from: Date;
    to: Date;
    productCode?: string;
    metricKey?: string;
    user?: string;
    requestId?: string;
    offset: number;
    limit: number;
  }): Promise<UsageEventRow[]> {
    const res = await this.pool.query<{
      created_at: Date;
      product_code: string;
      product_name: string;
      metric_key: string;
      total_amount: string;
      requested_amount: string | null;
      user_name: string | null;
      user_no: string | null;
      request_id: string | null;
    }>(
      `select e.created_at, prod.product_code, prod.product_name,
              e.metric_key, e.total_amount::text as total_amount,
              e.requested_amount::text as requested_amount,
              coalesce(up.display_name, u.account) as user_name,
              u.user_no::text as user_no,
              e.request_id
         ${USAGE_EVENTS_FROM}
        where ${USAGE_EVENTS_WHERE}
        order by e.created_at desc
        limit $8 offset $9`,
      [...usageEventsParams(input), input.limit, input.offset],
    );
    return res.rows.map((r) => ({
      createdAt: r.created_at,
      productCode: r.product_code,
      productName: r.product_name,
      metricKey: r.metric_key,
      totalAmount: Number(r.total_amount),
      requestedAmount:
        r.requested_amount === null ? null : Number(r.requested_amount),
      userName: r.user_name,
      userNo: r.user_no,
      requestId: r.request_id,
    }));
  }

  /**
   * 同一筛选下的条数与实扣量合计——**独立于分页**,客户拿它跟配额页/账单对数。
   * 与明细查询共用 FROM / WHERE,免得两边谓词漂移导致「明细加起来不等于合计」。
   */
  async countUsageEvents(input: {
    workspaceId: string;
    from: Date;
    to: Date;
    productCode?: string;
    metricKey?: string;
    user?: string;
    requestId?: string;
  }): Promise<{ total: number; totalAmount: number }> {
    const res = await this.pool.query<{ total: string; total_amount: string }>(
      `select count(*)::text as total,
              coalesce(sum(e.total_amount), 0)::text as total_amount
         ${USAGE_EVENTS_FROM}
        where ${USAGE_EVENTS_WHERE}`,
      usageEventsParams(input),
    );
    const row = res.rows[0];
    return {
      total: Number(row?.total ?? 0),
      totalAmount: Number(row?.total_amount ?? 0),
    };
  }

  /** 按成员统计(近 N 天 usage_events 按 end_user_id 聚合,未归集单列一桶)。 */
  async listUsageByMember(input: {
    workspaceId: string;
    metric: string;
    days: number;
  }): Promise<UsageMemberRow[]> {
    const res = await this.pool.query<{
      user_name: string | null;
      user_no: string | null;
      total: string;
      event_count: string;
      last_at: Date;
    }>(
      // user_no 一并带出:调用记录二级页按它筛成员(可视码,UUID 不出口)
      `select case when e.end_user_id is null then null
                   else coalesce(up.display_name, u.account) end as user_name,
              u.user_no::text as user_no,
              sum(e.total_amount)::text as total,
              count(*)::text as event_count,
              max(e.created_at) as last_at
         from metering.usage_events e
         left join account.users u on u.id = e.end_user_id
         left join account.user_profiles up on up.user_id = e.end_user_id
        where e.workspace_id = $1
          and e.metric_key = $2
          and e.created_at >= now() - make_interval(days => $3)
        group by e.end_user_id, 1, u.user_no
        order by sum(e.total_amount) desc`,
      [input.workspaceId, input.metric, input.days],
    );
    return res.rows.map((r) => ({
      userName: r.user_name,
      userNo: r.user_no,
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
