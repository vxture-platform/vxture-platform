/**
 * Read current and historical workspace entitlement facts for shared projections.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-23
 */
import {
  SUBSCRIPTION_STATUSES,
  TIERS,
  type ComponentRole,
  type SaleAxes,
  type SubscriptionStatus,
} from "@vxture-platform/shared"; // ⚠️ 跨层引用: Use the canonical commercial value domains.
import type { SubscriptionReadPool } from "./subscribed-products.read";

// ============================================================================
// Commercial selection rules shared with C2
// ============================================================================
// tier values are the @vxture-platform/shared contract (product_220 §1). The rank map is
// engine logic (highest-tier-wins merge, D6) derived from that single source —
// bundled backing is NOT a tier and surfaces via the `bundled` boolean instead.
const TIER_RANK: Record<string, number> = Object.fromEntries(
  TIERS.map((t, i) => [t, i]),
);

export interface ComponentRow {
  productCode: string;
  /** Effective tier (overrides applied in SQL); NULL on bundled components (D6). */
  tierCode: string | null;
  /** primary = the product the plan sells; bundled = bundled-sale backing (D6). */
  role: ComponentRole;
  features: string[] | null;
  /** plan_components.quota jsonb — { metricKey: value } (numbers or arrays). */
  quota: Record<string, unknown> | null;
}

/** Raw representative-candidate row (one standalone subscription × product). */
export interface SubscriptionFactsRow {
  productCode: string;
  status: SubscriptionStatus;
  trialEndAt: Date | null;
  endAt: Date | null;
  autoRenew: boolean;
}

const STATUS_RANK: Record<string, number> = Object.fromEntries(
  SUBSCRIPTION_STATUSES.map((s, i) => [s, i]),
);

/**
 * Pick the representative subscription: highest status precedence (the
 * @shared array order — live states first, suspended above expired so an
 * operator freeze is not masked); tie → latest period end, with an open
 * end (endAt null = perpetual/rolling) counting as latest.
 * @param rows - Primary subscription candidates for one product.
 * @returns The candidate whose facts should be presented together.
 */
export function pickRepresentative(
  rows: SubscriptionFactsRow[],
): SubscriptionFactsRow | undefined {
  let best: SubscriptionFactsRow | undefined;
  for (const row of rows) {
    if (!best) {
      best = row;
      continue;
    }
    const r = STATUS_RANK[row.status] ?? Infinity;
    const b = STATUS_RANK[best.status] ?? Infinity;
    if (r < b) {
      best = row;
    } else if (r === b) {
      const rowEnd = row.endAt === null ? Infinity : row.endAt.getTime();
      const bestEnd = best.endAt === null ? Infinity : best.endAt.getTime();
      if (rowEnd > bestEnd) best = row;
    }
  }
  return best;
}

/**
 * Resolve sale coverage from all live components using the C2 tier ladder.
 * @param rows - The product's current primary and bundled coverage.
 * @returns The effective tier and whether a separate bundle covers the product.
 */
export function resolveEntitlementCoverage(
  rows: readonly ComponentRow[],
): Pick<SaleAxes, "tier" | "bundled"> {
  const axes: Pick<SaleAxes, "tier" | "bundled"> = {
    tier: null,
    bundled: false,
  };
  let bestRank = -1;
  for (const row of rows) {
    // tier: primary components only (D6) — bundled components carry no
    // commercial grade and instead raise the bundled flag.
    const rank = row.tierCode === null ? -1 : (TIER_RANK[row.tierCode] ?? -1);
    if (row.role === "bundled") {
      axes.bundled = true;
    } else if (rank > bestRank || axes.tier === null) {
      bestRank = rank;
      axes.tier = row.tierCode;
    }
  }
  return axes;
}

// ============================================================================
// Read-only coverage inputs
// ============================================================================

interface ComponentSqlRow {
  product_code: string;
  tier_code: string | null;
  component_role: "primary" | "bundled";
  features: string[] | null;
  quota: Record<string, unknown> | null;
}

/**
 * Distinct product codes this workspace has ever had ANY plan_component
 * coverage for — primary (standalone purchase) OR bundled (product_220
 * §2: a product can carry real entitlement, e.g. `bundled: true`, with no
 * primary subscription of its own ever existing). Restricting to
 * `component_role = 'primary'` would silently hide bundled-only coverage
 * from the entitlements panel — the exact "both facts survive" case §2
 * calls out as the reason the bundled boolean exists in the first place.
 * @param pool - Existing commerce read pool.
 * @param workspaceId - The authorized workspace.
 * @returns Product codes with current or past plan coverage.
 */
export async function readWorkspaceEntitlementProductCodes(
  pool: SubscriptionReadPool,
  workspaceId: string,
): Promise<string[]> {
  const res = await pool.query<{ product_code: string }>(
    `select distinct prod.product_code
       from metering.subscriptions ts
       join product.plan_components pc on pc.plan_version_id = ts.plan_version_id
       join product.products prod on prod.id = pc.product_id
      where ts.workspace_id = $1 and ts.deleted_at is null`,
    [workspaceId],
  );
  return res.rows.map((r) => r.product_code);
}

/**
 * Load every active or trialing component rather than stopping at the first.
 * @param pool - Existing commerce read pool.
 * @param workspaceId - The authorized workspace.
 * @param productCodes - Scope of the entitlement resolution.
 * @returns Live coverage with currently effective tier overrides.
 */
export async function readLiveEntitlementComponents(
  pool: SubscriptionReadPool,
  workspaceId: string,
  productCodes: string[],
): Promise<ComponentRow[]> {
  const res = await pool.query<ComponentSqlRow>(
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
 * (status precedence, tie → latest period end) is pure logic in the shared
 * selection rules above. For products with no rows, the caller resolves facts
 * to `status: null` ("never subscribed", not a status value); bundled-only
 * coverage contributes no primary subscription → also null.
 * @param pool - Existing commerce read pool.
 * @param workspaceId - The authorized workspace.
 * @param productCodes - Scope of the entitlement resolution.
 * @returns Primary subscription candidates grouped by product.
 */
export async function readSubscriptionFactCandidates(
  pool: SubscriptionReadPool,
  workspaceId: string,
  productCodes: string[],
): Promise<Map<string, SubscriptionFactsRow[]>> {
  const res = await pool.query<{
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

// ============================================================================
// Minimal workspace projection
// ============================================================================

export interface WorkspaceEntitlementSummary {
  productCode: string;
  tier: string | null;
  status: SubscriptionStatus | null;
  bundled: boolean;
}

/**
 * Read desktop entitlement facts without resolving limits or usage pools.
 * @param pool - Existing commerce read pool.
 * @param workspaceId - Exact workspace authorized by the caller.
 * @returns All historically covered products, including bundled-only coverage.
 */
export async function readWorkspaceEntitlementSummary(
  pool: SubscriptionReadPool,
  workspaceId: string,
): Promise<WorkspaceEntitlementSummary[]> {
  const codes = await readWorkspaceEntitlementProductCodes(pool, workspaceId);
  if (!codes.length) return [];
  const [components, facts] = await Promise.all([
    readLiveEntitlementComponents(pool, workspaceId, codes),
    readSubscriptionFactCandidates(pool, workspaceId, codes),
  ]);
  const byProduct = new Map<string, ComponentRow[]>();
  for (const component of components) {
    const rows = byProduct.get(component.productCode) ?? [];
    rows.push(component);
    byProduct.set(component.productCode, rows);
  }
  return codes.map((productCode) => ({
    productCode,
    ...resolveEntitlementCoverage(byProduct.get(productCode) ?? []),
    status: pickRepresentative(facts.get(productCode) ?? [])?.status ?? null,
  }));
}
