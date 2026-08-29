/**
 * product-app-tiles.ts - 应用中心磁贴：当前工作空间实际持有的产品
 * @package  @vxture/bff-console
 * @layer    Application
 * @category lib
 * @description
 *   `GET /api/me/apps` 的数据来源。此前是一份写死的四块目录（APP_CATALOG，
 *   2026-08-30 退役）：三块是控制台自己的板块——那是导航不是数据，已挪回门户的
 *   导航配置（config/navigation.ts）；一块「助手」按订阅门控，但门控把 tenant id
 *   当 workspace id 传，从来没开过。现在磁贴 = product.products ∩ 默认工作空间的
 *   有效订阅，与 /api/subscription/subscribed-products 同一条 join 链，只是按
 *   产品折叠：一产品一磁贴，不管背后有几条订阅在撑。
 *
 * @author AI-Generated
 * @date 2026-08-30
 */

import type { Pool } from "pg";

// ============================================================================
// Types
// ============================================================================

/**
 * 「持有」= 订阅处于这两个态。与 service-subscription 的 ACTIVATED 同一集合：
 * `expiring` 只是枚举里的保留值，状态机从不写入；overdue/suspended 是欠费与
 * 停用，产品此时不该出现在启动台上。
 */
export const HELD_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;
export type HeldSubscriptionStatus =
  (typeof HELD_SUBSCRIPTION_STATUSES)[number];

/** 一块磁贴 = 一个产品。 */
export interface ProductAppTile {
  /** product.products.product_code——磁贴身份，产品改名不变。 */
  code: string;
  name: string;
  nick: string | null;
  iconUrl: string | null;
  /** product.product_webhooks.home_url；未登记为 null，门户回落到 /subscription。 */
  homeUrl: string | null;
  /** 撑起这块磁贴的最高优先级订阅态：active 压过 trialing。 */
  status: HeldSubscriptionStatus;
  /** 上述那条订阅的套餐名与档位。 */
  planName: string;
  tier: string | null;
}

/** 查询行：一条订阅 × 一个套餐组件 × 一个产品。同一产品可能出现多行。 */
export interface HeldProductRow {
  product_code: string;
  product_name: string;
  product_nick: string | null;
  icon_url: string | null;
  home_url: string | null;
  status: string;
  plan_name: string;
  tier: string | null;
  component_role: string;
  sort: number;
}

// ============================================================================
// SQL
// ============================================================================

/**
 * 默认工作空间一步 join 进来（而不是先查 workspace id 再查订阅）：没有默认
 * 工作空间的租户拿到的是空列表，不是 400——启动台是壳层的一个视图，数据问题
 * 该在订阅页报，不该让壳层的一角 4xx。
 *
 * component_role 不过滤：套餐捆绑进来的产品（bundled）同样是这个工作空间持有
 * 的。subscribed-products 只取 primary 是因为那页按订阅开卡，这里按产品开卡。
 */
export const HELD_PRODUCT_TILES_SQL = `
  select prod.product_code, prod.product_name, prod.product_nick, prod.icon_url,
         pw.home_url, ts.status, pl.plan_name, pc.tier, pc.component_role, prod.sort
    from metering.subscriptions ts
    join tenancy.workspaces w on w.id = ts.workspace_id
    join product.plan_versions pv on pv.id = ts.plan_version_id
    join product.plans pl on pl.id = pv.plan_id
    join product.plan_components pc on pc.plan_version_id = pv.id
    join product.products prod on prod.id = pc.product_id
    left join product.product_webhooks pw on pw.product_id = prod.id
   where w.tenant_id = $1 and w.is_default and w.deleted_at is null
     and ts.deleted_at is null and ts.status = any($2::text[])
     and prod.deleted_at is null and prod.status = 'active'
     and prod.is_customer_visible = true
   order by prod.sort asc, prod.product_code asc`;

// ============================================================================
// Helpers
// ============================================================================

const STATUS_RANK: Record<HeldSubscriptionStatus, number> = {
  active: 0,
  trialing: 1,
};
/** 同一状态下 primary 组件优先——它的 plan_name/tier 才是用户买的那份。 */
const ROLE_RANK: Record<string, number> = { primary: 0, bundled: 1 };

function isHeldStatus(status: string): status is HeldSubscriptionStatus {
  return (HELD_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * 按产品折叠查询行：每个 product_code 只留一块磁贴，取 (status, component_role)
 * 排名最靠前的那条订阅来标注套餐与档位。纯函数，方便不连库测试。
 *
 * @param rows - 查询行（顺序不作假设）
 * @returns 按 products.sort、product_code 排序的磁贴
 */
export function collapseProductTiles(
  rows: readonly HeldProductRow[],
): ProductAppTile[] {
  const byCode = new Map<
    string,
    { rank: number; sort: number; tile: ProductAppTile }
  >();
  for (const row of rows) {
    // SQL 已按状态过滤；这里再判一次是为了让函数自己成立，不依赖调用方。
    if (!isHeldStatus(row.status)) continue;
    const rank =
      STATUS_RANK[row.status] * 10 + (ROLE_RANK[row.component_role] ?? 9);
    const prev = byCode.get(row.product_code);
    if (prev && prev.rank <= rank) continue;
    byCode.set(row.product_code, {
      rank,
      sort: row.sort,
      tile: {
        code: row.product_code,
        name: row.product_name,
        nick: row.product_nick,
        iconUrl: row.icon_url,
        homeUrl: row.home_url,
        status: row.status,
        planName: row.plan_name,
        tier: row.tier,
      },
    });
  }
  return [...byCode.values()]
    .sort((a, b) => a.sort - b.sort || a.tile.code.localeCompare(b.tile.code))
    .map((entry) => entry.tile);
}

/**
 * 读出租户默认工作空间持有的产品磁贴。
 *
 * @param pool - 商务库连接池（COMMERCE_PG_POOL）
 * @param tenantId - 当前租户 id
 * @returns 磁贴列表；无默认工作空间或无有效订阅时为空数组
 */
export async function listHeldProductTiles(
  pool: Pick<Pool, "query">,
  tenantId: string,
): Promise<ProductAppTile[]> {
  const res = await pool.query<HeldProductRow>(HELD_PRODUCT_TILES_SQL, [
    tenantId,
    [...HELD_SUBSCRIPTION_STATUSES],
  ]);
  return collapseProductTiles(res.rows);
}
