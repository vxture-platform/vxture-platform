/**
 * dashboard.router.ts — admin 首页的实时聚合（TD-036）。
 * @package @vxture/bff-admin
 *
 * 2026-09-08 自 platform-admins.router.ts 原样搬出。那个路由是运营账号管理，
 * 在治理平面 cutover（#121）里整体迁去 arche 了；这个端点跟「平台管理员」毫无关系，
 * 只是当年停在了那里，于是它一个人拖着 1176 行已经没人调的代码不能删。
 *
 * 搬迁**不改行为**：SQL、周期算法、字段映射逐字节照搬，权限门仍是
 * `operator:account.manage`。那道门对首页聚合而言语义偏紧（首页不该要求
 * 运营账号管理权），但改它等于改「谁能看见 admin 首页」——那是产品裁定，
 * 不该混在一次清理里顺手做掉。要改另开一件事。
 *
 * 路径由 `/api/platform-admins/dashboard-overview` 改为 `/api/dashboard/overview`；
 * 调用方只有 admin 首页一处，随同一版本一起发。
 */
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { ADMIN_BFF_RO_POOL } from "../tokens";
import type { RequestContext } from "../types/console.types";

@Controller("api/dashboard")
export class DashboardRouter {
  constructor(@Inject(ADMIN_BFF_RO_POOL) private readonly pool: Pool) {}

  // GET /api/dashboard/overview?period=recent30|total|year|quarter|month
  // TD-036: replaces the admin home page's hardcoded snapshot literals with
  // live aggregates. Every field here has a real backing table; metrics with
  // no backing table anywhere in the schema (model token/call volume,
  // platform uptime, service/product ratings, real infra health monitoring,
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
}

function mapDashboardOverviewRow(
  period: PeriodKey,
  row: DashboardOverviewRow | undefined,
): DashboardOverviewRecord {
  const n = (v: number | undefined) => v ?? 0;
  const money = (v: string | undefined) => Number(v ?? 0);
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
        and created_at >= bounds.prev_since and created_at < bounds.prev_until)::int as ticket_total_in_prev_period
`;

/**
 * 与搬迁前的 `assertCanManagePlatformAdmins` 逐字相同（仅更名）。
 * 门没有放松也没有收紧——见文件头。
 */
function assertCanReadDashboard(req: Request & RequestContext): void {
  if (!req.user) {
    throw new UnauthorizedException("No active session");
  }

  if (!req.capabilities?.includes("operator:account.manage")) {
    throw new ForbiddenException("Missing platform.admin.manage capability");
  }
}
