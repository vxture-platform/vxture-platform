import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import { REBUCKET_HORIZON_DAYS } from "../service/usage-periods";

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
 *
 * Window bounds, the one pattern this file allows (owner ruling 4, 2026-10-04):
 * compute in timestamp-without-time-zone space first, convert to timestamptz
 * LAST with an explicit `at time zone 'UTC'`. The old days bound
 * `(now() at time zone 'UTC')::date - interval '35 days'` was a bare timestamp,
 * and comparing it to a timestamptz column made PostgreSQL interpret it in the
 * SESSION TimeZone: under Asia/Shanghai every pass rewrote UTC day D-36 as the
 * 8-hour sum of 16:00–23:59Z, then the day slid out of the window and was never
 * recomputed — every day older than 35 days stayed truncated, and weeks/months/
 * years summed the damage upward. `(date - N)::timestamp at time zone 'UTC'`
 * is session-independent (probed under four session zones: one instant); note
 * that `(date - N) at time zone 'UTC'` without the `::timestamp` is NOT (PG casts
 * the date through the session zone first), and `timestamptz - interval 'N days'`
 * is DST-shifted in a DST session zone. Integer-day subtraction on the date,
 * explicit cast, convert last.
 *
 * Second lock: the whole pass runs in one transaction under
 * `SET LOCAL TIME ZONE 'UTC'`, so even if the database-level default
 * (ALTER DATABASE … SET timezone = 'UTC', 00_schemas.sql) is ever changed
 * underneath us, this job's SQL sees UTC. The bounds above do not need it;
 * it is belt and braces for the one job that writes these tables.
 */
@Injectable()
export class PgUsageRollupRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  /** One full pass over all five layers; returns upserted row count. */
  async rollup(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // SET LOCAL ends with the transaction; it never leaks into the pooled
      // connection's next borrower.
      await client.query("set local time zone 'UTC'");
      let touched = 0;

      // events → hours (recompute last 26h of hourly buckets)
      touched += await this.exec(
        client,
        `insert into metering.usage_summary_hours
           (workspace_id, product_id, metric_key, period_hour, total_amount, created_at, updated_at)
         select e.workspace_id, e.product_id, e.metric_key,
                date_trunc('hour', e.created_at at time zone 'UTC') at time zone 'UTC',
                sum(e.total_amount), now(), now()
           from metering.usage_events e
          where e.created_at >= (date_trunc('hour', now() at time zone 'UTC') - interval '26 hours') at time zone 'UTC'
          group by 1, 2, 3, 4
         on conflict (workspace_id, product_id, metric_key, period_hour)
         do update set total_amount = excluded.total_amount, updated_at = now()`,
      );

      // hours → days (recompute last REBUCKET_HORIZON_DAYS days; the same
      // constant bounds the console's per-user-zone re-bucketing of the hour
      // table — both say how many days of hours count as a reliable source)
      touched += await this.exec(
        client,
        `insert into metering.usage_summary_days
           (workspace_id, product_id, metric_key, period_day, total_amount, created_at, updated_at)
         select h.workspace_id, h.product_id, h.metric_key,
                (h.period_hour at time zone 'UTC')::date,
                sum(h.total_amount), now(), now()
           from metering.usage_summary_hours h
          where h.period_hour >= ((now() at time zone 'UTC')::date - ${REBUCKET_HORIZON_DAYS})::timestamp at time zone 'UTC'
          group by 1, 2, 3, 4
         on conflict (workspace_id, product_id, metric_key, period_day)
         do update set total_amount = excluded.total_amount, updated_at = now()`,
      );

      // days → weeks (ISO Monday; recompute last ~15 weeks). date vs timestamp
      // comparison never goes through a time zone, so these three stay as is.
      touched += await this.exec(
        client,
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
        client,
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
        client,
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

      await client.query("commit");
      return touched;
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async exec(client: PoolClient, sql: string): Promise<number> {
    const res = await client.query(sql);
    return res.rowCount ?? 0;
  }
}
