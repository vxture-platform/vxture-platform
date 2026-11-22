/**
 * subscribed-products.read.ts - Shared workspace subscription and product icon reads.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category repository
 * @author AI-Generated
 * @date 2026-11-22
 */

/** Narrow read port compatible with existing platform PostgreSQL pools. */
export interface SubscriptionReadPool {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SubscribedProductRow {
  subscription_id: string;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  product_nick: string | null;
  icon_url: string | null;
  icon_version: string | null;
  home_url: string | null;
  release_version: string | null;
  released_at: Date | null;
  plan_name: string;
  tier: string | null;
  seats: string | null;
  assigned_seats: string;
  subscription_kind: string;
  cycle_unit: string;
  status: string;
  start_at: Date | null;
  end_at: Date | null;
  auto_renew: boolean;
  maintenance_window_id: string | null;
  maintenance_until: Date | null;
  suspension_reason: string | null;
  suspension_expected_resume_at: Date | null;
  suspension_extends_term: boolean | null;
}

export interface ProductIconRow {
  mime_type: string;
  bytes: Buffer;
  checksum: string;
}

// ============================================================================
// Existing subscription facts; callers retain authorization and presentation
// ============================================================================

/** Read existing subscription facts for one verified workspace, without writes. */
export async function readSubscribedProducts(
  pool: SubscriptionReadPool,
  workspaceId: string,
): Promise<SubscribedProductRow[]> {
  const result = await pool.query<SubscribedProductRow>(
    `select ts.id as subscription_id,
            prod.id as product_id, prod.product_code, prod.product_name,
            prod.product_nick, prod.icon_url, pi.checksum as icon_version, pw.home_url, prod.release_version, prod.released_at,
            prod.maintenance_window_id, prod.maintenance_until,
            pl.plan_name, pc.tier, pc.quota->>'seat.max' as seats,
            (select count(*) from metering.product_seats ps
              where ps.workspace_id = ts.workspace_id and ps.product_id = prod.id
                and ps.revoked_at is null) as assigned_seats,
            ts.subscription_kind, ts.cycle_unit, ts.status,
            ts.start_at, ts.end_at, ts.auto_renew,
            sus.suspension_reason, sus.suspension_expected_resume_at,
            sus.suspension_extends_term
       from metering.subscriptions ts
       join product.plan_versions pv on pv.id = ts.plan_version_id
       join product.plans pl on pl.id = pv.plan_id
       left join lateral (
         select tier, quota, product_id from product.plan_components
          where plan_version_id = ts.plan_version_id and component_role = 'primary'
          limit 1
       ) pc on true
       left join product.products prod on prod.id = pc.product_id
       left join product.product_webhooks pw on pw.product_id = prod.id
       left join product.product_icons pi on pi.product_id = prod.id
       left join lateral (
         select s2.reason as suspension_reason,
                s2.expected_resume_at as suspension_expected_resume_at,
                s2.extends_term as suspension_extends_term
           from metering.subscription_suspensions s2
          where s2.subscription_id = ts.id and s2.resumed_at is null
          limit 1
       ) sus on true
      where ts.workspace_id = $1 and ts.deleted_at is null
        and ts.status <> 'cancelled'
      order by coalesce(ts.start_at, ts.created_at) desc
      limit 100`,
    [workspaceId],
  );
  return result.rows;
}

/** Product branding is public; preserve the existing non-deleted product lookup. */
export async function readProductIcon(
  pool: SubscriptionReadPool,
  productCode: string,
): Promise<ProductIconRow | null> {
  const result = await pool.query<ProductIconRow>(
    `SELECT i.mime_type, i.bytes, i.checksum
       FROM product.product_icons i
       JOIN product.products p ON p.id = i.product_id
      WHERE p.product_code = $1 AND p.deleted_at IS NULL`,
    [productCode],
  );
  return result.rows[0] ?? null;
}
