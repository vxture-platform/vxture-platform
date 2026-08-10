import { Inject, Injectable } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import type {
  ConsumeInput,
  ConsumePoolTake,
  ConsumeResult,
} from "../types/consume.types";

/**
 * Single-writer usage consume path (platform-data-architecture-schema.md §8.3).
 * One READ COMMITTED transaction:
 *   1. idempotency pre-claim (INSERT usage_idempotency ON CONFLICT DO NOTHING);
 *      replay returns the prior committed result.
 *   2. lock candidate quota_pools FOR UPDATE in the total order
 *      priority, component_role(bundled first), effective_at, id (also the lock order).
 *   3. lazy zero-out pools whose reset period rolled over (+ quota_pool_reset audit).
 *   4. mode branch (product_metric.consume_mode): atomic => the deduction is
 *      all-or-nothing (an over-limit call deducts nothing); divisible =>
 *      waterfall, partial coverage allowed. **Either way the call is recorded.**
 *   5. UPDATE quota_used += took on the locked pools.
 *   6. INSERT usage_event(head) + usage_event_pools(detail); backfill
 *      usage_idempotency(event_id, consumed, per_pool).
 *
 * This endpoint RECORDS; it does not adjudicate (owner determination
 * 2026-08-10). It answers "how much was used" and "how much quota covered it",
 * and the caller decides what to do about the gap — disable the control, keep
 * serving, upsell. Two consequences fall out of that and both used to be wrong:
 * the event records the **requested** amount rather than the covered amount,
 * and it is written even when nothing could be deducted. Under the old shape a
 * workspace with no published plan metered as zero: the usage happened, the
 * record did not, and the only trail left was the caller's own log.
 *
 * NOTE: the SQL locking/waterfall/reset logic is verifiable only against a live DB
 * (integration test at the B15 cutover); typecheck does not exercise it.
 */
@Injectable()
export class PgConsumeRepository {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  async consume(input: ConsumeInput): Promise<ConsumeResult> {
    const amount = BigInt(input.amount);
    if (amount <= 0n) {
      return { status: "ok", consumed: "0", perPool: [], replayed: false };
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");

      // 1. idempotency pre-claim
      const claim = await client.query(
        `insert into metering.usage_idempotencies (idempotency_key, created_at)
         values ($1, now()) on conflict (idempotency_key) do nothing
         returning idempotency_key`,
        [input.idempotencyKey],
      );
      if ((claim.rowCount ?? 0) === 0) {
        // key already claimed → return the prior committed result (blocks on in-flight)
        const prev = await client.query<{
          event_id: string | null;
          consumed: string | null;
          per_pool: ConsumePoolTake[] | null;
        }>(
          `select event_id, consumed, per_pool from metering.usage_idempotencies
            where idempotency_key = $1 for share`,
          [input.idempotencyKey],
        );
        await client.query("commit");
        const r = prev.rows[0];
        return {
          status: "ok",
          consumed: r?.consumed != null ? String(r.consumed) : "0",
          perPool: r?.per_pool ?? [],
          ...(r?.event_id ? { eventId: r.event_id } : {}),
          replayed: true,
        };
      }

      // consume_mode resolution (product_220 §4): the L0 platform registry is
      // authoritative for shared metrics; product_metrics for product-scoped
      // ones. A platform hit also switches pool matching to workspace scope.
      const platRes = await client.query<{ consume_mode: string | null }>(
        `select consume_mode from product.platform_metrics
          where metric_key = $1 and status = 'active' limit 1`,
        [input.metricKey],
      );
      const isShared = platRes.rows.length > 0;
      let mode: string;
      if (isShared) {
        mode = platRes.rows[0]!.consume_mode ?? "divisible";
      } else {
        const modeRes = await client.query<{ consume_mode: string | null }>(
          `select consume_mode from product.product_metrics
            where product_id = $1 and metric_key = $2 limit 1`,
          [input.productId, input.metricKey],
        );
        mode = modeRes.rows[0]?.consume_mode ?? "divisible";
      }

      // 2. lock candidate pools (product_220 §4.3 reserved/shared). Candidate set:
      //    own product's pools (reserved, always) + — only for a platform metric
      //    and only when BOTH the pool's product and the caller participate in
      //    the workspace sharing policy — other participants' pools (shared).
      //    Empty policy => own only => all-reserved safe default.
      //    LOCK order is global/product-agnostic (deadlock-free); the burn order
      //    below re-sorts own-first ("自留先烧、共享兜底").
      const poolsRes = await client.query<{
        id: string;
        product_id: string;
        quota_limit: string;
        quota_used: string;
        reset_period: string;
        current_period_start: Date | null;
      }>(
        `select id, product_id, quota_limit, quota_used, reset_period, current_period_start
           from metering.quota_pools qp
          where qp.workspace_id = $1
            and qp.metric_key = $3
            and qp.status = 'active'
            and (qp.expires_at is null or qp.expires_at > now())
            -- D10 live-coverage gate (write-side twin of the C2 read gate):
            -- subscription-backed pools are only burnable while their
            -- subscription is active/trialing; addon/override pools
            -- (subscription_id null) live by their own expires_at. Read-side
            -- gating on purpose — admin renew (expired→active) revives pools
            -- without a re-materialization step. The EXISTS subquery takes no
            -- row locks, so the FOR UPDATE lock order on quota_pools is
            -- unchanged (deadlock-freedom argument intact).
            and (qp.subscription_id is null or exists (
                   select 1 from metering.subscriptions ts
                    where ts.id = qp.subscription_id
                      and ts.status in ('active', 'trialing')
                      and ts.deleted_at is null))
            and ( qp.product_id = $2
                  or ( $4
                       and exists (select 1 from metering.resource_sharing_policies pp
                                    where pp.workspace_id = $1 and pp.metric_key = $3
                                      and pp.product_id = qp.product_id)
                       and exists (select 1 from metering.resource_sharing_policies px
                                    where px.workspace_id = $1 and px.metric_key = $3
                                      and px.product_id = $2) ) )
          order by priority asc, (component_role = 'bundled') desc, effective_at asc, id asc
          for update`,
        [input.workspaceId, input.productId, input.metricKey, isShared],
      );
      // burn own-first (reserved before shared), preserving the locked priority order within each group
      const orderedRows = [...poolsRes.rows].sort(
        (a, b) =>
          (a.product_id === input.productId ? 0 : 1) -
          (b.product_id === input.productId ? 0 : 1),
      );

      // 3. lazy zero-out for pools whose reset period rolled over
      const pools: { id: string; available: bigint }[] = [];
      for (const p of orderedRows) {
        let used = BigInt(p.quota_used);
        if (
          p.reset_period !== "none" &&
          needsReset(p.reset_period, p.current_period_start)
        ) {
          await client.query(
            `insert into metering.quota_pool_resets (pool_id, period_start, used_before_reset, reset_at)
             values ($1, $2, $3, now())`,
            [p.id, p.current_period_start, p.quota_used],
          );
          await client.query(
            `update metering.quota_pools
                set quota_used = 0, current_period_start = date_trunc($2, now()), updated_at = now()
              where id = $1`,
            [p.id, p.reset_period === "day" ? "day" : "month"],
          );
          used = 0n;
        }
        const available = BigInt(p.quota_limit) - used;
        pools.push({ id: p.id, available: available > 0n ? available : 0n });
      }

      const totalAvailable = pools.reduce((s, p) => s + p.available, 0n);

      // 4. atomic mode: all-or-nothing applies to the POOL DEDUCTION, not to the
      // record. The caller has already used what it is reporting — refusing to
      // write it down does not un-use it, it only loses the number. So an
      // over-limit atomic call deducts nothing and is still recorded in full.
      const atomicOverLimit = mode === "atomic" && totalAvailable < amount;

      // 5. waterfall deduction (divisible allows partial success)
      let remaining = amount;
      const takes: { poolId: string; took: bigint }[] = [];
      for (const p of atomicOverLimit ? [] : pools) {
        if (remaining <= 0n) break;
        const take = p.available < remaining ? p.available : remaining;
        if (take <= 0n) continue;
        takes.push({ poolId: p.id, took: take });
        remaining -= take;
      }
      const covered = amount - remaining;

      for (const t of takes) {
        await client.query(
          `update metering.quota_pools set quota_used = quota_used + $2, updated_at = now()
            where id = $1`,
          [t.poolId, t.took.toString()],
        );
      }

      // 6. head + detail + idempotency backfill
      const perPool: ConsumePoolTake[] = takes.map((t) => ({
        poolId: t.poolId,
        took: t.took.toString(),
      }));
      // The event records what the caller USED (the requested amount), not what
      // the pools happened to cover. Those are different facts and the table
      // holds both: total_amount = used, and the per-pool detail = covered.
      // Writing only the covered part is how a workspace with no published plan
      // ended up metered as zero — the usage happened, the record did not.
      const eventId = await this.writeUsageEvent(
        client,
        input,
        amount,
        amount,
        takes,
      );
      await client.query(
        `update metering.usage_idempotencies
            set event_id = $2, consumed = $3, per_pool = $4::jsonb
          where idempotency_key = $1`,
        [
          input.idempotencyKey,
          eventId ?? null,
          amount.toString(),
          JSON.stringify(perPool),
        ],
      );

      await client.query("commit");
      return {
        // `consumed` is what the caller used; `status` reports whether quota
        // covered it. Neither is a verdict — the caller decides what to do with
        // an uncovered call (disable the control, keep serving, upsell). The
        // platform records and reports; it does not gate.
        status: covered >= amount ? "ok" : "insufficient",
        consumed: amount.toString(),
        perPool,
        ...(eventId ? { eventId } : {}),
        replayed: false,
      };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  private async writeUsageEvent(
    client: PoolClient,
    input: ConsumeInput,
    amount: bigint,
    consumed: bigint,
    takes: { poolId: string; took: bigint }[],
  ): Promise<string> {
    // Head + detail in one CTE. tenant_usage_event is partitioned by created_at, so
    // its PK (and the _pool composite FK) is (id, created_at); we must NOT round-trip
    // created_at through JS (Date loses the microseconds of now() -> FK violation) —
    // the detail rows read e.created_at straight from the head insert.
    const res = await client.query<{ event_id: string }>(
      `with e as (
         insert into metering.usage_events
           (workspace_id, product_id, metric_key, total_amount, requested_amount,
            idempotency_key, request_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, now())
         returning id, created_at
       )
       insert into metering.usage_event_pools
         (event_id, event_created_at, quota_pool_id, took)
       select e.id, e.created_at, d.pool_id, d.took
         from e, unnest($8::uuid[], $9::bigint[]) as d(pool_id, took)
       returning event_id`,
      [
        input.workspaceId,
        input.productId,
        input.metricKey,
        consumed.toString(),
        amount.toString(),
        input.idempotencyKey,
        input.requestId ?? null,
        takes.map((t) => t.poolId),
        takes.map((t) => t.took.toString()),
      ],
    );
    return res.rows[0]!.event_id;
  }
}

/** True when the pool's current period started before the current period floor. */
function needsReset(
  resetPeriod: string,
  currentPeriodStart: Date | null,
): boolean {
  if (currentPeriodStart === null) return true;
  const now = new Date();
  const floor = new Date(currentPeriodStart);
  if (resetPeriod === "day") {
    return (
      floor.getUTCFullYear() !== now.getUTCFullYear() ||
      floor.getUTCMonth() !== now.getUTCMonth() ||
      floor.getUTCDate() !== now.getUTCDate()
    );
  }
  // month
  return (
    floor.getUTCFullYear() !== now.getUTCFullYear() ||
    floor.getUTCMonth() !== now.getUTCMonth()
  );
}
