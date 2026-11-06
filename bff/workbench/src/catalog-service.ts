/**
 * Public catalog and workspace-bound subscription response projections.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category aggregator
 * @author AI-Generated
 * @date 2026-11-05
 */
import type { Pool } from "pg";

interface CatalogRow {
  productCode: string;
  productName: string;
  productNick: string | null;
  productType: string;
  description: string | null;
  iconUrl: string | null;
  releaseVersion: string | null;
  releaseStage: string;
  status: string;
  maintenance: { until: string | null } | null;
}
interface SubscriptionRow {
  productCode: string;
  status: string;
  tier: string | null;
  maintenance: { until: string | null } | null;
}

// ============================================================================
// Queries use the registry and the verified active workspace, never a default.
// ============================================================================
const MAINTENANCE = `case when p.maintenance_window_id is not null
  then jsonb_build_object('until', p.maintenance_until) else null end`;
const CATALOG = `select p.product_code as "productCode", p.product_name as "productName",
  p.product_nick as "productNick", p.product_type as "productType", p.description,
  p.icon_url as "iconUrl", p.release_version as "releaseVersion", p.release_stage as "releaseStage",
  p.status, ${MAINTENANCE} as maintenance
  from product.products p
  where p.deleted_at is null and p.is_customer_visible and p.status in ('active', 'developing')
  order by p.sort, p.product_code`;
const SUBSCRIPTIONS = `select distinct p.product_code as "productCode", s.status,
  coalesce(o.override_tier_code, pc.tier) as tier,
  ${MAINTENANCE} as maintenance
  from metering.subscriptions s
  join tenancy.workspaces w on w.id = s.workspace_id
  join product.plan_versions pv on pv.id = s.plan_version_id
  join product.plan_components pc on pc.plan_version_id = s.plan_version_id
  join product.products p on p.id = pc.product_id
  left join metering.subscription_entitlement_overrides o
    on o.subscription_id = s.id and o.product_id = p.id
    and (o.expires_at is null or o.expires_at > now())
  where w.id = $1 and w.tenant_id = $2 and w.deleted_at is null
    and s.tenant_id = $2
    and s.deleted_at is null and pc.component_role = 'primary' and pc.tier is not null
    and s.status <> 'cancelled'
    and p.deleted_at is null and p.is_customer_visible
  order by p.product_code, s.status`;

/** Read models contain no price, payment, plan-management or private registry fields. */
export class CatalogService {
  constructor(private readonly pool: Pick<Pool, "query">) {}
  async catalog(): Promise<CatalogRow[]> {
    return (await this.pool.query<CatalogRow>(CATALOG)).rows;
  }
  async subscriptions(
    workspace: string,
    tenant: string,
  ): Promise<SubscriptionRow[]> {
    return (
      await this.pool.query<SubscriptionRow>(SUBSCRIPTIONS, [workspace, tenant])
    ).rows;
  }
  async entries(): Promise<{ code: string; homeUrl: string | null }[]> {
    return (
      await this.pool.query<{ code: string; homeUrl: string | null }>(`
      select p.product_code as code, pw.home_url as "homeUrl"
        from product.products p
        left join product.product_webhooks pw on pw.product_id = p.id
       where p.deleted_at is null and p.is_customer_visible and p.status = 'active'
       order by p.sort, p.product_code`)
    ).rows;
  }
}
