/**
 * dashboard.router.ts — admin 首页的实时聚合（TD-036）。
 * @package @vxture/bff-admin
 *
 * 2026-09-08 自 platform-admins.router.ts 原样搬出。那个路由是运营账号管理，
 * 在治理平面 cutover（#121）里整体迁去 arche 了；这个端点跟「平台管理员」毫无关系，
 * 只是当年停在了那里，于是它一个人拖着 1176 行已经没人调的代码不能删。
 *
 * 搬迁时 SQL、周期算法、字段映射逐字节照搬。权限门原是 `operator:account.manage`
 * ——那是 arche 的码（运营账号管理），首页聚合借它，等于只有治理平台的人看得见 admin
 * 首页。2026-09-14 三平台拆分裁定：admin 不认别的平台的码，首页改为**进得了 admin
 * 就看得见**（本平台根码 `admin.plane`）。
 *
 * 路径由 `/api/platform-admins/dashboard-overview` 改为 `/api/dashboard/overview`；
 * 调用方只有 admin 首页一处，随同一版本一起发。
 */
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { PLANE_ROOT } from "../auth/plane";
import { ADMIN_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/console.types";

@Controller("api/dashboard")
export class DashboardRouter {
  constructor(@Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool) {}

  // GET /api/dashboard/overview?period=recent30|total|year|quarter|month
  // TD-036: replaces the admin home page's hardcoded snapshot literals with
  // live aggregates. Every field here has a real backing table; metrics with
  // no backing table anywhere in the schema (model token/call volume,
  // platform uptime, real infra health monitoring,
  // product-catalog rankings — all blocked on TD-029's missing schema) are
  // NOT synthesized here — the frontend renders those as an explicit
  // "data source not yet built" state instead of inventing a number.
  @Get("overview")
  async getDashboardOverview(
    @Req() req: Request & RequestContext,
    @Query("period") periodParam?: string,
  ): Promise<DashboardOverviewRecord> {
    assertCanReadDashboard(req);
    const period = parsePeriodKey(periodParam);
    const { since, prevSince, prevUntil } = periodBounds(period, new Date());

    const result = await this.pool.query<DashboardOverviewRow>(
      DASHBOARD_OVERVIEW_SQL,
      [since, prevSince, prevUntil],
    );
    const row = result.rows[0];
    return mapDashboardOverviewRow(period, row);
  }

  /**
   * GET /api/dashboard/reviews —— 客户评价列表（运营总览「客户评价」区的下钻）。
   *
   * 与总览同一道门（本平面根码）：它就是那三张卡背后的明细，不另立权限码。
   *
   * **默认只列带留言的**：运营点进来是为了看客户说了什么；纯分数在三张卡上
   * 已经汇总过了，逐条再列一遍只是噪声。`withComment=false` 可以看全部。
   *
   * 不返回 account_id / tenant_id 这类 UUID —— 任何场景不展示 UUID。评价人用
   * 租户名 + 可视码呈现；读不到就是「—」，不退回 id。
   */
  @Get("reviews")
  async listReviews(
    @Req() req: Request & RequestContext,
    @Query("limit") limitParam?: string,
    @Query("offset") offsetParam?: string,
    @Query("withComment") withCommentParam?: string,
  ): Promise<{ items: ReviewListItem[]; total: number }> {
    assertCanReadDashboard(req);
    const limit = clampInt(limitParam, 50, 1, 200);
    const offset = clampInt(offsetParam, 0, 0, 100_000);
    // 缺省为 true；只有显式传 "false" 才看全部。
    const withComment = withCommentParam !== "false";

    const result = await this.pool.query<ReviewListRow>(REVIEW_LIST_SQL, [
      withComment,
      limit,
      offset,
    ]);
    return {
      items: result.rows.map(mapReviewRow),
      total: Number(result.rows[0]?.total_count ?? 0),
    };
  }

  /**
   * GET /api/dashboard/notices —— 运营通告（本平面可见的那些）。
   *
   * 发布面在 opera（owner 2026-09-20：「面向内部运营的由 opera 发布」），admin
   * **只读**。与总览同一道门：它是首页「系统消息」区的数据源，不另立权限码。
   *
   * `scope=digest`（默认）落 owner 那条摘要规则：**当天已读 + 所有未读**。
   * `scope=all` 给二级页，去掉已读那一条谓词。
   */
  @Get("notices")
  async listNotices(
    @Req() req: Request & RequestContext,
    @Query("scope") scopeParam?: string,
    @Query("limit") limitParam?: string,
    @Query("offset") offsetParam?: string,
  ): Promise<{ items: OperatorNoticeItem[]; total: number; unread: number }> {
    assertCanReadDashboard(req);
    const operatorId = req.user?.id;
    if (!operatorId) throw new UnauthorizedException("No active session");
    const digest = scopeParam !== "all";
    const limit = clampInt(limitParam, digest ? 20 : 50, 1, 200);
    const offset = clampInt(offsetParam, 0, 0, 100_000);

    const result = await this.pool.query<NoticeListRow>(NOTICE_LIST_SQL, [
      PLANE_NAME,
      operatorId,
      digest,
      limit,
      offset,
    ]);
    return {
      items: result.rows.map(mapNoticeRow),
      total: Number(result.rows[0]?.total_count ?? 0),
      // 未读数单独回：铃铛角标要的是「还有几条没看」，不是本页列了几条。
      unread: Number(result.rows[0]?.unread_count ?? 0),
    };
  }

  /** POST /api/dashboard/notices/:id/read —— 标记本人已读。幂等。 */
  @Post("notices/:id/read")
  async markNoticeRead(
    @Req() req: Request & RequestContext,
    @Param("id") id: string,
  ): Promise<{ id: string; readAt: string }> {
    assertCanReadDashboard(req);
    const operatorId = req.user?.id;
    if (!operatorId) throw new UnauthorizedException("No active session");
    if (!UUID_RE.test(id)) throw new BadRequestException("Invalid notice id");

    // 重复标记不报错,只是把时间刷新——「我又看了一次」不是错误。
    // 但 on conflict 必须写 do update 而不是 do nothing:do nothing 时
    // returning 不回行,调用方拿不到 read_at。
    const result = await this.pool.query<{ read_at: Date }>(
      `insert into admin.operator_notice_reads (notice_id, operator_id)
       select $1::uuid, $2::uuid
        where exists (select 1 from admin.operator_notices
                       where id = $1::uuid and deleted_at is null)
       on conflict (notice_id, operator_id) do update set read_at = now()
       returning read_at`,
      [id, operatorId],
    );
    const row = result.rows[0];
    // 通告不存在或已撤回时 where exists 不成立,插不进去 → 0 行。
    if (!row) throw new NotFoundException("Notice not found");
    return { id, readAt: row.read_at.toISOString() };
  }
}

/** 本平面的代号，与 target_planes 里的值同一套（PLANE_ROOT 是 "admin.plane"）。 */
const PLANE_NAME = PLANE_ROOT.split(".")[0] as string;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OperatorNoticeItem {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  link: string | null;
  source: "manual" | "system";
  publishedAt: string;
  /** 本人读过的时刻；null = 未读。 */
  readAt: string | null;
  /** 发布人显示名；system 来源与已注销账号都回 null。 */
  createdByName: string | null;
}

interface NoticeListRow {
  id: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
  source: string;
  published_at: Date;
  read_at: Date | null;
  created_by_name: string | null;
  total_count: string;
  unread_count: string;
}

function mapNoticeRow(row: NoticeListRow): OperatorNoticeItem {
  return {
    id: row.id,
    severity: row.severity as OperatorNoticeItem["severity"],
    title: row.title,
    body: row.body,
    link: row.link,
    source: row.source as OperatorNoticeItem["source"],
    publishedAt: row.published_at.toISOString(),
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdByName: row.created_by_name,
  };
}

/**
 * $1 = 本平面代号，$2 = 当前运营者，$3 = 是否摘要档，$4 = limit，$5 = offset。
 *
 * `$3::bool` 写成 CASE 的条件而不是靠 JS 拼 where：SQL 一旦插值，那一族静态守卫
 * 当场读不懂它，变瞎且恒绿。
 *
 * `visible` 先收敛出「本平面能看见的未撤回未过期通告」，两个计数与分页都基于它，
 * 免得三处各写一遍过滤条件、日后改漏一处。
 * **不回 created_by 那个 uuid**——全站规则：任何场景不展示 UUID。
 */
const NOTICE_LIST_SQL = `
  with visible as (
    select n.id, n.severity, n.title, n.body, n.link, n.source, n.published_at,
           r.read_at,
           nullif(a.display_name, '') as created_by_name
      from admin.operator_notices n
      left join admin.operator_notice_reads r
             on r.notice_id = n.id and r.operator_id = $2::uuid
      left join admin.operator_account a on a.id = n.created_by
     where n.deleted_at is null
       and (n.expires_at is null or n.expires_at > now())
       and (n.target_planes = '{}' or $1 = any(n.target_planes))
  ), scoped as (
    select * from visible
     where not $3::bool
        or read_at is null
        or read_at >= date_trunc('day', now())
  )
  select s.*,
         (select count(*) from scoped)::text                        as total_count,
         (select count(*) from visible where read_at is null)::text  as unread_count
    from scoped s
   order by s.read_at is not null, s.published_at desc, s.id desc
   limit $4 offset $5
`;

export interface ReviewListItem {
  /** 可视码：租户号。列表的行标识用它，不用主键。 */
  tenantNo: string;
  tenantName: string;
  productName: string;
  productScore: number | null;
  priceScore: number | null;
  serviceScore: number | null;
  comment: string | null;
  createdAt: string;
}

interface ReviewListRow {
  tenant_no: string | null;
  tenant_name: string | null;
  product_name: string | null;
  product_score: number | null;
  price_score: number | null;
  service_score: number | null;
  comment: string | null;
  created_at: Date;
  total_count: string;
}

function mapReviewRow(row: ReviewListRow): ReviewListItem {
  return {
    // 读不到显示「—」，不退回 id（全站规则：任何场景不展示 UUID）。
    tenantNo: row.tenant_no ?? "—",
    tenantName: row.tenant_name ?? "—",
    productName: row.product_name ?? "—",
    productScore: row.product_score,
    priceScore: row.price_score,
    serviceScore: row.service_score,
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * $1 = 只看带留言的（bool），$2 = limit，$3 = offset。
 *
 * `$1::bool` 写成 CASE 的条件而不是靠 JS 拼 where：SQL 一旦插值，静态守卫
 * （lint:anchor-writes 那一族）就读不懂它了，当场变瞎且恒绿。
 *
 * 总数与页一起取（window count），省一次往返；空白留言不算留言。
 */
const REVIEW_LIST_SQL = `
  select
    t.tenant_no::text        as tenant_no,
    coalesce(t.display_name, t.name) as tenant_name,
    p.product_name           as product_name,
    r.product_score,
    r.price_score,
    r.service_score,
    r.comment,
    r.created_at,
    count(*) over ()::text   as total_count
  from support.product_reviews r
  left join tenancy.tenants  t on t.id = r.tenant_id
  left join product.products p on p.id = r.product_id
  where r.deleted_at is null
    and (not $1::bool or (r.comment is not null and btrim(r.comment) <> ''))
  order by r.created_at desc
  limit $2 offset $3
`;

/** 取整并夹到 [min, max]；读不出数就用 fallback。 */
function clampInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

type PeriodKey = "recent30" | "total" | "year" | "quarter" | "month";
const PERIOD_KEYS: readonly PeriodKey[] = [
  "recent30",
  "total",
  "year",
  "quarter",
  "month",
];

function parsePeriodKey(value: string | undefined): PeriodKey {
  return (PERIOD_KEYS as readonly string[]).includes(value ?? "")
    ? (value as PeriodKey)
    : "recent30";
}

/**
 * `total` has no lower bound (since=null) and no meaningful "previous
 * period" to diff against (prevSince/prevUntil stay null) — the SQL treats a
 * null bound as "no filter" via `bounds.since is null or ...`.
 */
function periodBounds(
  period: PeriodKey,
  now: Date,
): { since: Date | null; prevSince: Date | null; prevUntil: Date | null } {
  switch (period) {
    case "recent30": {
      const since = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      const prevSince = new Date(now.getTime() - 60 * 24 * 3600 * 1000);
      return { since, prevSince, prevUntil: since };
    }
    case "month": {
      const since = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const prevSince = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );
      return { since, prevSince, prevUntil: since };
    }
    case "quarter": {
      const q = Math.floor(now.getUTCMonth() / 3);
      const since = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
      const prevSince = new Date(
        Date.UTC(now.getUTCFullYear(), (q - 1) * 3, 1),
      );
      return { since, prevSince, prevUntil: since };
    }
    case "year": {
      const since = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const prevSince = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
      return { since, prevSince, prevUntil: since };
    }
    case "total":
    default:
      return { since: null, prevSince: null, prevUntil: null };
  }
}

interface DashboardOverviewRecord {
  period: PeriodKey;
  tenants: {
    total: number;
    active: number;
    newInPeriod: number;
    newInPrevPeriod: number;
  };
  users: { total: number; newInPeriod: number; newInPrevPeriod: number };
  subscriptions: {
    active: number;
    trialing: number;
    newInPeriod: number;
    newInPrevPeriod: number;
    trialConvertedInPeriod: number;
    renewalsDue: number;
    renewalsAtRisk: number;
  };
  revenue: {
    paidInPeriod: number;
    paidInPrevPeriod: number;
    paidTotal: number;
    outstandingAmount: number;
    outstandingCount: number;
    overdueCount: number;
  };
  tickets: {
    totalInPeriod: number;
    resolved: number;
    inProgress: number;
    pending: number;
    totalInPrevPeriod: number;
  };
  /**
   * 客户评价（support.product_reviews，2026-09-20 起）。
   *
   * 三项**各带各的分母**：`average` 是那一项的均分，`count` 是评了那一项的条数。
   * 三项分数各自可空，`AVG` 跳过 `NULL`，所以只评了产品的客户不会把价格分的
   * 分母也撑大。`reviewCount` 是评价条数，与任一项的 `count` 都不是一个数。
   *
   * `average` 为 `null` = 这一项还没人评，不是 0 分。
   *
   * 口径是**全周期**，不跟随 period：评价来得稀疏，按周期切会让卡片在没有新
   * 评价的那一周直接空掉，看起来像坏了。
   */
  reviews: {
    productScore: { average: number | null; count: number };
    priceScore: { average: number | null; count: number };
    serviceScore: { average: number | null; count: number };
    reviewCount: number;
  };
}

interface DashboardOverviewRow {
  tenant_total: number;
  tenant_active: number;
  tenant_new_in_period: number;
  tenant_new_in_prev_period: number;
  user_total: number;
  user_new_in_period: number;
  user_new_in_prev_period: number;
  sub_active: number;
  sub_trialing: number;
  sub_new_in_period: number;
  sub_new_in_prev_period: number;
  sub_trial_converted_in_period: number;
  renewals_due: number;
  renewals_at_risk: number;
  revenue_paid_in_period: string;
  revenue_paid_in_prev_period: string;
  revenue_paid_total: string;
  revenue_outstanding_amount: string;
  revenue_outstanding_count: number;
  revenue_overdue_count: number;
  ticket_total_in_period: number;
  ticket_resolved: number;
  ticket_in_progress: number;
  ticket_pending: number;
  ticket_total_in_prev_period: number;
  review_product_avg: string | null;
  review_product_cnt: number;
  review_price_avg: string | null;
  review_price_cnt: number;
  review_service_avg: string | null;
  review_service_cnt: number;
  review_count: number;
}

function mapDashboardOverviewRow(
  period: PeriodKey,
  row: DashboardOverviewRow | undefined,
): DashboardOverviewRecord {
  const n = (v: number | undefined) => v ?? 0;
  const money = (v: string | undefined) => Number(v ?? 0);
  /** null/undefined 一律保持 null：没人评不是 0 分。 */
  const avg = (v: string | null | undefined) =>
    v === null || v === undefined ? null : Number(v);
  return {
    period,
    tenants: {
      total: n(row?.tenant_total),
      active: n(row?.tenant_active),
      newInPeriod: n(row?.tenant_new_in_period),
      newInPrevPeriod: n(row?.tenant_new_in_prev_period),
    },
    users: {
      total: n(row?.user_total),
      newInPeriod: n(row?.user_new_in_period),
      newInPrevPeriod: n(row?.user_new_in_prev_period),
    },
    subscriptions: {
      active: n(row?.sub_active),
      trialing: n(row?.sub_trialing),
      newInPeriod: n(row?.sub_new_in_period),
      newInPrevPeriod: n(row?.sub_new_in_prev_period),
      trialConvertedInPeriod: n(row?.sub_trial_converted_in_period),
      renewalsDue: n(row?.renewals_due),
      renewalsAtRisk: n(row?.renewals_at_risk),
    },
    revenue: {
      paidInPeriod: money(row?.revenue_paid_in_period),
      paidInPrevPeriod: money(row?.revenue_paid_in_prev_period),
      paidTotal: money(row?.revenue_paid_total),
      outstandingAmount: money(row?.revenue_outstanding_amount),
      outstandingCount: n(row?.revenue_outstanding_count),
      overdueCount: n(row?.revenue_overdue_count),
    },
    tickets: {
      totalInPeriod: n(row?.ticket_total_in_period),
      resolved: n(row?.ticket_resolved),
      inProgress: n(row?.ticket_in_progress),
      pending: n(row?.ticket_pending),
      totalInPrevPeriod: n(row?.ticket_total_in_prev_period),
    },
    reviews: {
      // null 原样传下去——「还没人评」与「0 分」必须分得开，
      // 用 ?? 0 兜底会让空数据长成满分表的反面。
      productScore: {
        average: avg(row?.review_product_avg),
        count: n(row?.review_product_cnt),
      },
      priceScore: {
        average: avg(row?.review_price_avg),
        count: n(row?.review_price_cnt),
      },
      serviceScore: {
        average: avg(row?.review_service_avg),
        count: n(row?.review_service_cnt),
      },
      reviewCount: n(row?.review_count),
    },
  };
}

// $1 = since (nullable, null = no lower bound i.e. "total"), $2 = prevSince
// (nullable), $3 = prevUntil (nullable, always equals $1 when both are set).
// `bounds.since is null or col >= bounds.since` makes a null bound a no-op
// filter rather than excluding everything.
const DASHBOARD_OVERVIEW_SQL = `
  with bounds as (
    select $1::timestamptz as since, $2::timestamptz as prev_since, $3::timestamptz as prev_until
  )
  select
    (select count(*) from tenancy.tenants where deleted_at is null)::int as tenant_total,
    (select count(*) from tenancy.tenants where deleted_at is null and status = 'active')::int as tenant_active,
    (select count(*) from tenancy.tenants, bounds
      where deleted_at is null and (bounds.since is null or created_at >= bounds.since))::int as tenant_new_in_period,
    (select count(*) from tenancy.tenants, bounds
      where deleted_at is null and bounds.prev_since is not null
        and created_at >= bounds.prev_since and created_at < bounds.prev_until)::int as tenant_new_in_prev_period,

    (select count(*) from account.users where deleted_at is null)::int as user_total,
    (select count(*) from account.users, bounds
      where deleted_at is null and (bounds.since is null or created_at >= bounds.since))::int as user_new_in_period,
    (select count(*) from account.users, bounds
      where deleted_at is null and bounds.prev_since is not null
        and created_at >= bounds.prev_since and created_at < bounds.prev_until)::int as user_new_in_prev_period,

    (select count(*) from metering.subscriptions where deleted_at is null and status = 'active')::int as sub_active,
    (select count(*) from metering.subscriptions where deleted_at is null and status = 'trialing')::int as sub_trialing,
    (select count(*) from metering.subscriptions, bounds
      where deleted_at is null and (bounds.since is null or created_at >= bounds.since))::int as sub_new_in_period,
    (select count(*) from metering.subscriptions, bounds
      where deleted_at is null and bounds.prev_since is not null
        and created_at >= bounds.prev_since and created_at < bounds.prev_until)::int as sub_new_in_prev_period,
    (select count(*) from metering.subscription_histories, bounds
      where from_status = 'trialing' and to_status = 'active'
        and (bounds.since is null or created_at >= bounds.since))::int as sub_trial_converted_in_period,
    (select count(*) from metering.subscription_renewals
      where status in ('pending', 'processing'))::int as renewals_due,
    (select count(*) from metering.subscription_renewals
      where status in ('failed', 'dunning'))::int as renewals_at_risk,

    (select coalesce(sum(paid_amount), 0) from billing.payments, bounds
      where pay_status = 'paid' and (bounds.since is null or paid_at >= bounds.since)) as revenue_paid_in_period,
    (select coalesce(sum(paid_amount), 0) from billing.payments, bounds
      where pay_status = 'paid' and bounds.prev_since is not null
        and paid_at >= bounds.prev_since and paid_at < bounds.prev_until) as revenue_paid_in_prev_period,
    (select coalesce(sum(paid_amount), 0) from billing.payments
      where pay_status = 'paid') as revenue_paid_total,
    (select coalesce(sum(payable_amount - coalesce(paid_amount, 0)), 0) from billing.invoices
      where bill_status in ('unpaid', 'partial', 'overdue') and deleted_at is null) as revenue_outstanding_amount,
    (select count(*) from billing.invoices
      where bill_status in ('unpaid', 'partial', 'overdue') and deleted_at is null)::int as revenue_outstanding_count,
    (select count(*) from billing.invoices
      where bill_status = 'overdue' and deleted_at is null)::int as revenue_overdue_count,

    (select count(*) from support.tickets, bounds
      where deleted_at is null and (bounds.since is null or created_at >= bounds.since)
        and status in ('resolved', 'closed'))::int as ticket_resolved,
    (select count(*) from support.tickets, bounds
      where deleted_at is null and (bounds.since is null or created_at >= bounds.since)
        and status in ('open', 'in_progress', 'reopened'))::int as ticket_in_progress,
    (select count(*) from support.tickets, bounds
      where deleted_at is null and (bounds.since is null or created_at >= bounds.since)
        and status = 'pending')::int as ticket_pending,
    (select count(*) from support.tickets, bounds
      where deleted_at is null and (bounds.since is null or created_at >= bounds.since))::int as ticket_total_in_period,
    (select count(*) from support.tickets, bounds
      where deleted_at is null and bounds.prev_since is not null
        and created_at >= bounds.prev_since and created_at < bounds.prev_until)::int as ticket_total_in_prev_period,
    -- 客户评价：三项各自 AVG/COUNT（各带各的分母），外加评价条数。
    -- 不带 bounds：评价来得稀疏，按周期切会让卡片在没有新评价的那一周空掉。
    (select avg(product_score)::numeric(3,2) from support.product_reviews
      where deleted_at is null) as review_product_avg,
    (select count(product_score) from support.product_reviews
      where deleted_at is null)::int as review_product_cnt,
    (select avg(price_score)::numeric(3,2) from support.product_reviews
      where deleted_at is null) as review_price_avg,
    (select count(price_score) from support.product_reviews
      where deleted_at is null)::int as review_price_cnt,
    (select avg(service_score)::numeric(3,2) from support.product_reviews
      where deleted_at is null) as review_service_avg,
    (select count(service_score) from support.product_reviews
      where deleted_at is null)::int as review_service_cnt,
    (select count(*) from support.product_reviews
      where deleted_at is null)::int as review_count
`;

/**
 * 首页门 = 本平台根码，见文件头。
 */
function assertCanReadDashboard(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  if (!req.capabilities?.includes(PLANE_ROOT)) {
    throw new ForbiddenException(`Missing ${PLANE_ROOT} capability`);
  }
}
