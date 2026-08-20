/**
 * platform-entitlements.service.ts — C2 entitlement resolution (read-only).
 *
 * Resolves the v2 envelope (product_220 §3, D12 contract contraction) for
 * workspace × product(s): subscription facts from ONE representative
 * subscription, sale axes (tier/bundled/limits) merged across ALL live
 * coverage (§11.3 heritage — unlike the token claim resolver, no "latest
 * subscription wins"), plus the per-pool consumable view from
 * metering.quota_pools. Strictly read-only: the lazy period reset stays
 * owned by the consume write path.
 *
 * DI note: the pg pool token is inlined (same as AppScopeResolver) to avoid
 * importing SubscriptionModule into vitest's module graph.
 */
import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import type { MergeStrategy } from "@vxture/shared";
import {
  buildQuotaPoolView,
  buildSubscriptionFacts,
  mergeSaleAxes,
  pickRepresentative,
  strategyKey,
  type ComponentRow,
  type MergeStrategyMap,
  type PoolRow,
  type ProductEntitlementView,
  type QuotaPoolView,
  type SubscriptionFactsRow,
} from "./entitlement-view";

const COMMERCE_PG_POOL = "COMMERCE_PG_POOL";

/** A platform-metric pool tagged with its contributing product (for policy filtering). */
interface PlatformPoolRow extends PoolRow {
  /** NULL = WS-level pool (ws_base / addon_purchase): no contributor, open to all products. */
  contributingProductCode: string | null;
  kind: string; // platform_metrics.kind
}

interface ComponentSqlRow {
  product_code: string;
  tier_code: string | null;
  component_role: "primary" | "bundled";
  features: string[] | null;
  quota: Record<string, unknown> | null;
}

interface StrategySqlRow {
  product_code: string;
  metric_key: string;
  merge_strategy: MergeStrategy;
}

interface PoolSqlRow {
  product_code: string;
  metric_key: string;
  quota_limit: string;
  quota_used: string;
  priority: number;
  reset_period: string;
  current_period_start: Date | null;
}

@Injectable()
export class PlatformEntitlementsService {
  constructor(@Inject(COMMERCE_PG_POOL) private readonly pool: Pool) {}

  /**
   * Resolve the entitlement view for every requested product code. Every
   * requested code is present in the result; products without any active
   * subscription resolve to the free fallback (tier null, empty pools, §11.4).
   */
  async resolve(
    workspaceId: string,
    productCodes: string[],
  ): Promise<Record<string, ProductEntitlementView>> {
    // liveSubscriptionIds feeds queryPools/queryPlatformPools (post-review
    // dedup, 2026-07-12: both used to independently re-derive the same
    // active/trialing predicate via their own correlated EXISTS). Chained
    // off its own promise — not folded into the Promise.all below — so
    // those two queries start as soon as liveSubscriptionIds resolves
    // rather than waiting on the slowest of the other five, which run
    // fully in parallel with it.
    const liveSubscriptionIdsP = this.queryLiveSubscriptionIds(workspaceId);
    const [
      components,
      strategies,
      pools,
      platformPools,
      policy,
      factsRows,
      gaugeUsage,
    ] = await Promise.all([
      this.queryComponents(workspaceId, productCodes),
      this.queryStrategies(productCodes),
      liveSubscriptionIdsP.then((ids) =>
        this.queryPools(workspaceId, productCodes, ids),
      ),
      liveSubscriptionIdsP.then((ids) =>
        this.queryPlatformPools(workspaceId, ids),
      ),
      this.querySharingPolicy(workspaceId),
      this.querySubscriptionFactsRows(workspaceId, productCodes),
      this.queryGaugeUsage(workspaceId),
    ]);

    const byProduct = new Map<string, ComponentRow[]>();
    for (const row of components) {
      (
        byProduct.get(row.productCode) ??
        byProduct.set(row.productCode, []).get(row.productCode)!
      ).push(row);
    }
    const poolsByProduct = new Map<string, PoolRow[]>();
    for (const row of pools) {
      (
        poolsByProduct.get(row.productCode) ??
        poolsByProduct.set(row.productCode, []).get(row.productCode)!
      ).push(row);
    }

    // COUNTER platform pools are policy-aware per product (product_220 §4.3):
    // own pools (reserved) + (only when both it and the contributing product are
    // in the sharing policy) other participants' pools (shared). Empty => own only.
    const counterPlatformPools = platformPools.filter(
      (p) => p.kind !== "gauge",
    );
    const accessibleCounterPools = (code: string): PoolRow[] =>
      counterPlatformPools.filter((p) => {
        // WS-level pools (ws_base / addon_purchase) have no contributor and are
        // open to every product — policy governs cross-PRODUCT flow only.
        if (p.contributingProductCode === null) return true;
        if (p.contributingProductCode === code) return true; // own (reserved)
        const participants = policy.get(p.metricKey);
        return (
          participants !== undefined &&
          participants.has(p.contributingProductCode) &&
          participants.has(code)
        );
      });

    // GAUGE platform pools are WS-uniform (product_220 §4.4 / D5): one aggregated
    // row per metric — limit = Σ pool limits, remaining = limit − Σ water level
    // (UNCLAMPED, may be negative per R4; arda gates at ≤0). Same for every product.
    const gaugeAgg = new Map<string, { limit: bigint; priority: number }>();
    for (const p of platformPools) {
      if (p.kind !== "gauge") continue;
      const a = gaugeAgg.get(p.metricKey) ?? {
        limit: 0n,
        priority: p.priority,
      };
      a.limit += BigInt(p.quotaLimit);
      a.priority = Math.min(a.priority, p.priority);
      gaugeAgg.set(p.metricKey, a);
    }
    const gaugeRows: QuotaPoolView[] = [];
    for (const [metric, a] of gaugeAgg) {
      const used = gaugeUsage.get(metric) ?? 0n;
      gaugeRows.push({
        metric,
        limit: Number(a.limit),
        remaining: Number(a.limit - used), // unclamped: negative = overshoot
        priority: a.priority,
      });
    }

    const result: Record<string, ProductEntitlementView> = {};
    for (const code of productCodes) {
      const axes = mergeSaleAxes(byProduct.get(code) ?? [], strategies);
      const facts = buildSubscriptionFacts(
        pickRepresentative(factsRows.get(code) ?? []),
      );
      result[code] = {
        ...facts,
        tier: axes.tier,
        bundled: axes.bundled,
        limits: axes.limits,
        quota_pools: [
          ...buildQuotaPoolView([
            ...(poolsByProduct.get(code) ?? []),
            ...accessibleCounterPools(code),
          ]),
          ...gaugeRows,
        ],
      };
    }
    return result;
  }

  /** All active/trialing components for the workspace × products (no first-wins). */
  private async queryComponents(
    workspaceId: string,
    productCodes: string[],
  ): Promise<ComponentRow[]> {
    const res = await this.pool.query<ComponentSqlRow>(
      `SELECT prod.product_code,
              COALESCE(o.override_tier_code, pc.tier) AS tier_code,
              pc.component_role, pc.features, pc.quota
       FROM metering.subscriptions ts
       JOIN product.plan_versions pv ON pv.id = ts.plan_version_id AND pv.is_locked = true
       JOIN product.plan_components pc ON pc.plan_version_id = pv.id
       JOIN product.products prod ON prod.id = pc.product_id
       LEFT JOIN metering.subscription_entitlement_overrides o
         ON o.subscription_id = ts.id AND o.product_id = prod.id
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
       WHERE ts.workspace_id = $1
         AND prod.product_code = ANY($2::text[])
         AND ts.status IN ('active', 'trialing')
         AND ts.deleted_at IS NULL`,
      [workspaceId, productCodes],
    );
    return res.rows.map((r) => ({
      productCode: r.product_code,
      tierCode: r.tier_code,
      role: r.component_role,
      features: r.features,
      quota: r.quota,
    }));
  }

  /**
   * Representative-candidate rows per product (product_220 §3): ALL standalone
   * (primary) subscriptions of any status, with the fields the v2 subscription
   * facts need (trial/period end, auto-renew). The representative pick
   * (status precedence, tie → latest period end) is pure logic in
   * entitlement-view. Products with no rows → the caller resolves the facts
   * to `status: null` ("never subscribed", not a status value); bundled-only
   * coverage contributes no primary subscription → also null.
   */
  private async querySubscriptionFactsRows(
    workspaceId: string,
    productCodes: string[],
  ): Promise<Map<string, SubscriptionFactsRow[]>> {
    const res = await this.pool.query<{
      product_code: string;
      status: string;
      trial_end_at: Date | null;
      end_at: Date | null;
      auto_renew: boolean;
    }>(
      `SELECT DISTINCT ON (ts.id, prod.product_code)
              prod.product_code, ts.status, ts.trial_end_at, ts.end_at,
              ts.auto_renew
       FROM metering.subscriptions ts
       JOIN product.plan_versions pv ON pv.id = ts.plan_version_id
       JOIN product.plan_components pc
         ON pc.plan_version_id = pv.id AND pc.component_role = 'primary'
       JOIN product.products prod ON prod.id = pc.product_id
       WHERE ts.workspace_id = $1
         AND prod.product_code = ANY($2::text[])
         AND ts.deleted_at IS NULL
         -- D10 (product_220 §3): a never-paid trial that lapsed or was
         -- cancelled leaves as null (never-subscribed semantics) — 'expired'
         -- is reserved for paid lapse. A suspended trial still surfaces
         -- (freeze is not laundered into null).
         AND NOT (ts.subscription_kind = 'trial'
                  AND ts.status IN ('expired', 'cancelled'))`,
      [workspaceId, productCodes],
    );
    const map = new Map<string, SubscriptionFactsRow[]>();
    for (const r of res.rows) {
      (
        map.get(r.product_code) ??
        map.set(r.product_code, []).get(r.product_code)!
      ).push({
        productCode: r.product_code,
        status: r.status as SubscriptionFactsRow["status"],
        trialEndAt: r.trial_end_at,
        endAt: r.end_at,
        autoRenew: r.auto_renew,
      });
    }
    return map;
  }

  /** merge_strategy per (product, metric) — decides which quota keys are capabilities. */
  private async queryStrategies(
    productCodes: string[],
  ): Promise<MergeStrategyMap> {
    // per-product strategies
    const res = await this.pool.query<StrategySqlRow>(
      `SELECT prod.product_code, pm.metric_key, pm.merge_strategy
       FROM product.product_metrics pm
       JOIN product.products prod ON prod.id = pm.product_id
       WHERE prod.product_code = ANY($1::text[])`,
      [productCodes],
    );
    const map: MergeStrategyMap = {};
    for (const r of res.rows) {
      map[strategyKey(r.product_code, r.metric_key)] = r.merge_strategy;
    }
    // L0 platform metrics (product_220 §4): quota keys owned by the platform
    // registry are pool contributions for every product — never capabilities.
    const platform = await this.pool.query<{ metric_key: string }>(
      `SELECT metric_key FROM product.platform_metrics WHERE status = 'active'`,
    );
    for (const code of productCodes) {
      for (const r of platform.rows) {
        map[strategyKey(code, r.metric_key)] = "pool";
      }
    }
    return map;
  }

  /**
   * D10 (product_220 §3) live-coverage set for the whole workspace:
   * subscription ids currently active/trialing. Computed once and shared by
   * queryPools/queryPlatformPools (post-review dedup, 2026-07-12 — both
   * used to independently re-derive this exact predicate via their own
   * correlated EXISTS against metering.subscriptions). Deliberately
   * unscoped to productCodes: queryPlatformPools needs workspace-wide
   * coverage regardless of which products were requested.
   */
  private async queryLiveSubscriptionIds(
    workspaceId: string,
  ): Promise<string[]> {
    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM metering.subscriptions
        WHERE workspace_id = $1 AND status IN ('active', 'trialing')
          AND deleted_at IS NULL`,
      [workspaceId],
    );
    return res.rows.map((r) => r.id);
  }

  /** Active, unexpired pools in the consume path's waterfall order. */
  private async queryPools(
    workspaceId: string,
    productCodes: string[],
    liveSubscriptionIds: string[],
  ): Promise<PoolRow[]> {
    const res = await this.pool.query<PoolSqlRow>(
      `SELECT prod.product_code, qp.metric_key, qp.quota_limit, qp.quota_used,
              qp.priority, qp.reset_period, qp.current_period_start
       FROM metering.quota_pools qp
       JOIN product.products prod ON prod.id = qp.product_id
       WHERE qp.workspace_id = $1
         AND prod.product_code = ANY($2::text[])
         AND qp.status = 'active'
         AND (qp.expires_at IS NULL OR qp.expires_at > NOW())
         -- D10 live-coverage gate: subscription-backed pools only count while
         -- their subscription is active/trialing (mirrors queryComponents);
         -- addon/override pools (subscription_id NULL) live by expires_at.
         -- Read-side on purpose — admin renew (expired→active) revives pools
         -- with no re-materialization step. Array-membership against the
         -- precomputed set (queryLiveSubscriptionIds), not a per-row EXISTS.
         AND (qp.subscription_id IS NULL OR qp.subscription_id = ANY($3::uuid[]))
         AND NOT EXISTS (SELECT 1 FROM product.platform_metrics plm
                          WHERE plm.metric_key = qp.metric_key)
       ORDER BY qp.priority ASC, (qp.component_role = 'bundled') DESC,
                qp.effective_at ASC, qp.id ASC`,
      [workspaceId, productCodes, liveSubscriptionIds],
    );
    return res.rows.map((r) => ({
      productCode: r.product_code,
      metricKey: r.metric_key,
      quotaLimit: r.quota_limit,
      quotaUsed: r.quota_used,
      priority: r.priority,
      resetPeriod: r.reset_period,
      currentPeriodStart: r.current_period_start,
    }));
  }

  /**
   * L0 platform-metric pools for the workspace (product_220 §4): matched by
   * metric registry membership regardless of the contributing product, in the
   * same waterfall order as the consume path.
   */
  private async queryPlatformPools(
    workspaceId: string,
    liveSubscriptionIds: string[],
  ): Promise<PlatformPoolRow[]> {
    const res = await this.pool.query<
      PoolSqlRow & { contributing_product_code: string | null; kind: string }
    >(
      // LEFT JOIN products: WS-level pools (product_id NULL — ws_base /
      // addon_purchase, product_220 §4.4) have no contributing product and
      // must still count toward the workspace's limit Σ.
      `SELECT prod.product_code AS contributing_product_code, qp.metric_key,
              qp.quota_limit, qp.quota_used, qp.priority, qp.reset_period,
              qp.current_period_start, plm.kind
       FROM metering.quota_pools qp
       JOIN product.platform_metrics plm ON plm.metric_key = qp.metric_key
       LEFT JOIN product.products prod ON prod.id = qp.product_id
       WHERE qp.workspace_id = $1
         AND qp.status = 'active'
         AND (qp.expires_at IS NULL OR qp.expires_at > NOW())
         -- D10 live-coverage gate (same as queryPools): a lapsed contributor's
         -- platform-pool contribution (ai.credit / storage.bytes limit) drops
         -- out with its subscription. Array-membership against the
         -- precomputed set, not a per-row EXISTS.
         AND (qp.subscription_id IS NULL OR qp.subscription_id = ANY($2::uuid[]))
       ORDER BY qp.priority ASC, (qp.component_role = 'bundled') DESC,
                qp.effective_at ASC, qp.id ASC`,
      [workspaceId, liveSubscriptionIds],
    );
    return res.rows.map((r) => ({
      productCode: "", // view ignores it; contributingProductCode drives filtering
      contributingProductCode: r.contributing_product_code,
      metricKey: r.metric_key,
      quotaLimit: r.quota_limit,
      quotaUsed: r.quota_used,
      priority: r.priority,
      resetPeriod: r.reset_period,
      currentPeriodStart: r.current_period_start,
      kind: r.kind,
    }));
  }

  /** Σ gauge water level per gauge platform metric for the workspace (D5). */
  private async queryGaugeUsage(
    workspaceId: string,
  ): Promise<Map<string, bigint>> {
    const res = await this.pool.query<{ metric_key: string; total: string }>(
      `SELECT ug.metric_key, SUM(ug.value)::text AS total
         FROM metering.usage_gauges ug
         JOIN product.platform_metrics plm
           ON plm.metric_key = ug.metric_key AND plm.kind = 'gauge'
        WHERE ug.workspace_id = $1
        GROUP BY ug.metric_key`,
      [workspaceId],
    );
    const map = new Map<string, bigint>();
    for (const r of res.rows) map.set(r.metric_key, BigInt(r.total));
    return map;
  }

  /** Workspace sharing policy: metric_key → set of participating product_codes. */
  private async querySharingPolicy(
    workspaceId: string,
  ): Promise<Map<string, Set<string>>> {
    const res = await this.pool.query<{
      metric_key: string;
      product_code: string;
    }>(
      `SELECT rsp.metric_key, prod.product_code
         FROM metering.resource_sharing_policies rsp
         JOIN product.products prod ON prod.id = rsp.product_id
        WHERE rsp.workspace_id = $1`,
      [workspaceId],
    );
    const map = new Map<string, Set<string>>();
    for (const r of res.rows) {
      (
        map.get(r.metric_key) ??
        map.set(r.metric_key, new Set()).get(r.metric_key)!
      ).add(r.product_code);
    }
    return map;
  }
}
