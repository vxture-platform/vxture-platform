import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";

/**
 * Downsampling rollup for the usage_summary_* five-layer family
 * (data_commerce_200 §9): events → hours → days → weeks/months → years.
 * 纯统计/看板 — NEVER a billing basis (billing reads usage_events over the
 * subscription-anchored cycle window; the guardrail enforces the wording).
 *
 * Strategy: sliding-window RECOMPUTE, not incremental watermarks. Each pass
 * re-aggregates the recent window of the layer below and upserts with
 * `total_amount = EXCLUDED.total_amount` (each table's UNIQUE(workspace,
 * product, metric, period) key makes this idempotent). A recompute window
 * generously wider than the sweep cadence means missed ticks, restarts, and
 * cross-instance races all self-heal — the last writer recomputes the same
 * truth. Bucket boundaries are UTC throughout (matches the consume path's
 * UTC period logic); weeks are ISO Mondays per the DDL comment.
 */
@Injectable()
export class PgUsageRollupRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  /** One full pass over all five layers; returns upserted row count. */
  async rollup(): Promise<number> {
    let touched = 0;

    // events → hours (recompute last 26h of hourly buckets)
    touched += await this.exec(
      `insert into metering.usage_summary_hours
         (workspace_id, product_id, metric_key, period_hour, total_amount, created_at, updated_at)
       select e.workspace_id, e.product_id, e.metric_key,
              date_trunc('hour', e.created_at at time zone 'UTC') at time zone 'UTC',
              sum(e.total_amount), now(), now()
         from metering.usage_events e
        where e.created_at >= date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC' - interval '26 hours'
        group by 1, 2, 3, 4
       on conflict (workspace_id, product_id, metric_key, period_hour)
       do update set total_amount = excluded.total_amount, updated_at = now()`,
    );

    // hours → days (recompute last 35 days; hours retain ~3 months, ample)
    touched += await this.exec(
      `insert into metering.usage_summary_days
         (workspace_id, product_id, metric_key, period_day, total_amount, created_at, updated_at)
       select h.workspace_id, h.product_id, h.metric_key,
              (h.period_hour at time zone 'UTC')::date,
              sum(h.total_amount), now(), now()
         from metering.usage_summary_hours h
        where h.period_hour >= (now() at time zone 'UTC')::date - interval '35 days'
        group by 1, 2, 3, 4
       on conflict (workspace_id, product_id, metric_key, period_day)
       do update set total_amount = excluded.total_amount, updated_at = now()`,
    );

    // days → weeks (ISO Monday; recompute last ~15 weeks)
    touched += await this.exec(
      `insert into metering.usage_summary_weeks
         (workspace_id, product_id, metric_key, period_week, total_amount, created_at, updated_at)
       select d.workspace_id, d.product_id, d.metric_key,
              date_trunc('week', d.period_day)::date,
              sum(d.total_amount), now(), now()
         from metering.usage_summary_days d
        where d.period_day >= date_trunc('week', (now() at time zone 'UTC')::date)::date - interval '15 weeks'
        group by 1, 2, 3, 4
       on conflict (workspace_id, product_id, metric_key, period_week)
       do update set total_amount = excluded.total_amount, updated_at = now()`,
    );

    // days → months (YYYYMM; recompute current + 2 previous months. Days
    // retain ~13 months, so a month older than that can no longer recompute —
    // by then it is immutable history anyway.)
    touched += await this.exec(
      `insert into metering.usage_summary_months
         (workspace_id, product_id, metric_key, period_month, total_amount, created_at, updated_at)
       select d.workspace_id, d.product_id, d.metric_key,
              to_char(d.period_day, 'YYYYMM'),
              sum(d.total_amount), now(), now()
         from metering.usage_summary_days d
        where d.period_day >= date_trunc('month', (now() at time zone 'UTC')::date)::date - interval '2 months'
        group by 1, 2, 3, 4
       on conflict (workspace_id, product_id, metric_key, period_month)
       do update set total_amount = excluded.total_amount, updated_at = now()`,
    );

    // months → years (YYYY; recompute current + previous year)
    touched += await this.exec(
      `insert into metering.usage_summary_years
         (workspace_id, product_id, metric_key, period_year, total_amount, created_at, updated_at)
       select m.workspace_id, m.product_id, m.metric_key,
              left(m.period_month, 4),
              sum(m.total_amount), now(), now()
         from metering.usage_summary_months m
        where left(m.period_month, 4) >= to_char((now() at time zone 'UTC')::date - interval '1 year', 'YYYY')
        group by 1, 2, 3, 4
       on conflict (workspace_id, product_id, metric_key, period_year)
       do update set total_amount = excluded.total_amount, updated_at = now()`,
    );

    return touched;
  }

  private async exec(sql: string): Promise<number> {
    const res = await this.pool.query(sql);
    return res.rowCount ?? 0;
  }
}
