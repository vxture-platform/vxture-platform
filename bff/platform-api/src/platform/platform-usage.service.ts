/**
 * platform-usage.service.ts — C3 consume orchestration for the platform API
 * (product_310 P2.2). Thin layer over the commerce single-writer engine:
 * resolves product_code → product_id, delegates the transactional waterfall
 * to ConsumeService, then reads the post-consume period-aware pool state for
 * the contract's remaining_total / per_pool_breakdown enrichment (read-only —
 * this layer never touches quota_used).
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { ConsumeService } from "@vxture/service-subscription";
import { buildQuotaPoolView } from "./entitlement-view";
import type { EngineConsumeResult, PoolIdentity } from "./usage-view";

const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

interface PoolIdentitySqlRow {
  id: string;
  subscription_id: string | null;
  metric_key: string;
  quota_limit: string;
  quota_used: string;
  priority: number;
  reset_period: string;
  current_period_start: Date | null;
}

@Injectable()
export class PlatformUsageService {
  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(ConsumeService) private readonly consumeService: ConsumeService,
  ) {}

  /** product_code → id; null when the code is not in the catalog. */
  async resolveProductId(productCode: string): Promise<string | null> {
    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM product.products WHERE product_code = $1 AND deleted_at IS NULL`,
      [productCode],
    );
    return res.rows[0]?.id ?? null;
  }

  async consume(input: {
    workspaceId: string;
    productId: string;
    metricKey: string;
    amount: string;
    idempotencyKey: string;
    requestId?: string;
    /** optional end-user attribution (NULL bucket when absent). */
    endUserId?: string;
  }): Promise<EngineConsumeResult> {
    return this.consumeService.consume(input);
  }

  /**
   * Post-consume pool state for (workspace, product, metric): identity
   * (pool id → subscription) + period-aware remaining, waterfall order.
   */
  async readPools(
    workspaceId: string,
    productId: string,
    metricKey: string,
  ): Promise<PoolIdentity[]> {
    const res = await this.pool.query<PoolIdentitySqlRow>(
      `SELECT qp.id, qp.subscription_id, qp.metric_key, qp.quota_limit,
              qp.quota_used, qp.priority, qp.reset_period, qp.current_period_start
       FROM metering.quota_pools qp
       WHERE qp.workspace_id = $1
         AND qp.metric_key = $3
         AND qp.status = 'active'
         AND (qp.expires_at IS NULL OR qp.expires_at > NOW())
         -- D10 live-coverage gate (parity fix 2026-08-20: this read used to skip
         -- it, so a lapsed contributor's pool inflated remaining_total here
         -- while being invisible to both C2 and the actual deduction).
         AND (qp.subscription_id IS NULL OR EXISTS (
                SELECT 1 FROM metering.subscriptions ts
                 WHERE ts.id = qp.subscription_id
                   AND ts.status IN ('active', 'trialing')
                   AND ts.deleted_at IS NULL))
         -- product_id NULL = WS-level pool (ws_base / addon_purchase): open to
         -- every product, mirrors the consume candidate set.
         AND ( qp.product_id = $2
               OR qp.product_id IS NULL
               OR ( EXISTS (SELECT 1 FROM product.platform_metrics plm WHERE plm.metric_key = $3)
                    AND EXISTS (SELECT 1 FROM metering.resource_sharing_policies pp
                                 WHERE pp.workspace_id = $1 AND pp.metric_key = $3 AND pp.product_id = qp.product_id)
                    AND EXISTS (SELECT 1 FROM metering.resource_sharing_policies px
                                 WHERE px.workspace_id = $1 AND px.metric_key = $3 AND px.product_id = $2) ) )
       ORDER BY (qp.product_id = $2) DESC NULLS LAST, qp.priority ASC, (qp.component_role = 'bundled') DESC,
                qp.effective_at ASC, qp.id ASC`,
      [workspaceId, productId, metricKey],
    );
    const views = buildQuotaPoolView(
      res.rows.map((r) => ({
        productCode: "",
        metricKey: r.metric_key,
        quotaLimit: r.quota_limit,
        quotaUsed: r.quota_used,
        priority: r.priority,
        resetPeriod: r.reset_period,
        currentPeriodStart: r.current_period_start,
      })),
    );
    return res.rows.map((r, i) => ({
      poolId: r.id,
      subscriptionId: r.subscription_id,
      view: views[i]!,
    }));
  }

  /**
   * True when the metric is a registered gauge platform metric (D5). consume
   * rejects these (they use PUT /usage/gauge); the gauge endpoint requires them.
   */
  async isGaugeMetric(metricKey: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM product.platform_metrics
        WHERE metric_key = $1 AND kind = 'gauge' AND status = 'active' LIMIT 1`,
      [metricKey],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Record a gauge snapshot (data_commerce_240 §3): absolute water level per
   * (workspace, product, metric), last-write-wins by observed_at. Not written to
   * usage_events (gauge is not a deduction). Returns applied=false when a newer
   * snapshot already exists (idempotent, older report dropped).
   */
  async recordGauge(input: {
    workspaceId: string;
    productId: string;
    metricKey: string;
    value: string;
    observedAt: Date;
  }): Promise<{ applied: boolean; value: string; observedAt: Date }> {
    const upsert = await this.pool.query<{ value: string; observed_at: Date }>(
      `INSERT INTO metering.usage_gauges
         (workspace_id, product_id, metric_key, value, observed_at, updated_at, created_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (workspace_id, product_id, metric_key) DO UPDATE
         SET value = EXCLUDED.value, observed_at = EXCLUDED.observed_at, updated_at = now()
         WHERE EXCLUDED.observed_at >= metering.usage_gauges.observed_at
       RETURNING value::text AS value, observed_at`,
      [
        input.workspaceId,
        input.productId,
        input.metricKey,
        input.value,
        input.observedAt,
      ],
    );
    if (upsert.rows.length > 0) {
      return {
        applied: true,
        value: upsert.rows[0]!.value,
        observedAt: upsert.rows[0]!.observed_at,
      };
    }
    // ON CONFLICT WHERE rejected the update (an equal/newer snapshot exists) — return current.
    const cur = await this.pool.query<{ value: string; observed_at: Date }>(
      `SELECT value::text AS value, observed_at FROM metering.usage_gauges
        WHERE workspace_id = $1 AND product_id = $2 AND metric_key = $3`,
      [input.workspaceId, input.productId, input.metricKey],
    );
    return {
      applied: false,
      value: cur.rows[0]?.value ?? input.value,
      observedAt: cur.rows[0]?.observed_at ?? input.observedAt,
    };
  }
}
