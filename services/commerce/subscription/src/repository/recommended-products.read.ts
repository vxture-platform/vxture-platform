/**
 * Read tenant acquisition candidates from registered, publicly orderable products.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-23
 */
import type { SubscriptionReadPool } from "./subscribed-products.read";

export interface RecommendedProductRow {
  product_id: string;
  product_code: string;
  product_name: string;
  product_nick: string | null;
  description: string | null;
  release_version: string | null;
  released_at: Date | null;
  icon_url: string | null;
  tags: string[] | null;
  min_price: string;
  currency: string;
}

// ============================================================================
// Share candidate eligibility; only the Console projection reads prices.
// ============================================================================
const CURRENT_PLANS = `
  from product.products prod
  join product.plan_components pc
    on pc.product_id = prod.id and pc.component_role = 'primary'
  join product.plan_versions pv
    on pv.id = pc.plan_version_id and pv.is_locked = true
  join product.plans pl
    on pl.id = pv.plan_id and pl.current_version_id = pv.id
   and pl.deleted_at is null and pl.status = 'active'
   and pl.is_public = true and pl.is_customer_visible = true`;

// Preview products cannot be ordered; sunset products are renewal-only.
const TENANT_ACQUISITION = `
  where prod.deleted_at is null and prod.status = 'active'
    and prod.is_customer_visible = true
    and prod.standalone_subscribable = true
    and prod.release_stage not in ('preview', 'sunset')
    and not exists (
      select 1 from metering.subscriptions ts
      join product.plan_components sub_pc
        on sub_pc.plan_version_id = ts.plan_version_id
      where ts.tenant_id = $1 and ts.deleted_at is null
        and sub_pc.product_id = prod.id
    )`;

const SORT_LIMIT = "order by prod.sort asc, prod.product_code asc limit 6";

/**
 * Preserve the Console recommendation and displayed starting-price projection.
 * @param pool - Existing commerce read pool.
 * @param tenantId - Tenant already authorized by the caller.
 * @returns Ordered candidates with the existing starting price and currency.
 */
export async function readRecommendedProducts(
  pool: SubscriptionReadPool,
  tenantId: string,
): Promise<RecommendedProductRow[]> {
  return (
    await pool.query<RecommendedProductRow>(
      `select prod.id as product_id, prod.product_code, prod.product_name,
              prod.product_nick, prod.description, prod.release_version,
              prod.released_at, prod.icon_url, prod.tags,
              to_char(coalesce(min(pp.price), 0), 'FM999999999990.00') as min_price,
              coalesce(min(pp.currency), 'CNY') as currency
         ${CURRENT_PLANS}
         left join product.plan_prices pp on pp.plan_version_id = pv.id
         ${TENANT_ACQUISITION}
        group by prod.id, prod.product_code, prod.product_name, prod.product_nick,
                 prod.description, prod.release_version, prod.released_at,
                 prod.icon_url, prod.tags, prod.sort
        ${SORT_LIMIT}`,
      [tenantId],
    )
  ).rows;
}

/**
 * Filter the desktop surface to displayable agents before applying the limit.
 * @param pool - Existing read pool; this projection does not query plan prices.
 * @param tenantId - Tenant from the verified desktop session.
 * @returns Ordered candidate codes for public catalog enrichment.
 */
export async function readRecommendedAgentCodes(
  pool: SubscriptionReadPool,
  tenantId: string,
): Promise<{ productCode: string }[]> {
  return (
    await pool.query<{ productCode: string }>(
      `select prod.product_code as "productCode"
         ${CURRENT_PLANS}
         ${TENANT_ACQUISITION}
          and (prod.product_type = 'agent' or right(prod.product_type, 6) = '_agent')
          and prod.release_stage in ('stable', 'beta')
        group by prod.id, prod.sort, prod.product_code
        ${SORT_LIMIT}`,
      [tenantId],
    )
  ).rows;
}
