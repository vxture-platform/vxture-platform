/**
 * admin-entry.ts — 跳转到「本职之外的收口门户」的入口。
 * @package @vxture/opera
 * @layer Presentation
 * @category Navigation
 *
 * opera 只出跳转入口，不重建落在别的平面的管理面。当前两类去向：
 *   - **商业授权**（Atlas grants / price-rules / policies / quotas）归 **admin**
 *     （product_100_matrix.md，"产品发布管理"阶段四 2026-08-12）——商业封装层。
 *   - **RBAC / 治理**（角色 / 权限策略）归 **arche 治理平面**——三平面拆分后
 *     （2026-09-02 cutover）身份权限的写口单点在 arche，admin 也不再持有这两页。
 *
 * 跳转不带 portal-context（同 website→console 那套 encodePortalContext）：目标门户
 * 未实现 decodePortalContext 解析，带了也是死参数，不为不存在的能力搭架子。
 *
 * Runos 的商业层（commerce/bundles）还没建（M2 范围），没有对应链接可给——见
 * PlannedManagementPage 的占位页，这里不假装有。
 */

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

const DEFAULT_ADMIN_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://y.vxture.com"
    : "http://localhost:3030";

const ADMIN_BASE_URL = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_ADMIN_URL ?? DEFAULT_ADMIN_BASE_URL,
);

// arche 治理平面：真名不入仓（ops-hostname-placeholders），仓里用 g.vxture.com 占位，
// 真名走 worker-01 runtime env NEXT_PUBLIC_ARCHE_URL 注入。dev 端口 3050（同 arche 定义）。
const DEFAULT_ARCHE_BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://g.vxture.com"
    : "http://localhost:3050";

const ARCHE_BASE_URL = normalizeBaseUrl(
  process.env.NEXT_PUBLIC_ARCHE_URL ?? DEFAULT_ARCHE_BASE_URL,
);

/** admin 的 Atlas 商业页（grants / price-rules / policies / quotas）。 */
export function buildAdminAtlasGrantsUrl(): string {
  return `${ADMIN_BASE_URL}/atlas`;
}

/**
 * arche 治理平面的平台角色管理页（`admin.operator_role` 等鉴权表的写口单点）。
 *
 * RBAC 不是 opera 的职责——admin / opera / arche 的登录鉴权同读一套 `admin.operator_*`
 * 表，但角色权限的写口在三平面拆分后统一收口到 arche 治理面，避免多个门户各开一套
 * 写路径改同一张鉴权表。opera 只出跳转入口。
 */
export function buildArcheRolesUrl(): string {
  return `${ARCHE_BASE_URL}/roles`;
}

/** arche 治理平面的权限策略页（域/板块/页面/操作四级权限树）。 */
export function buildArchePermissionsUrl(): string {
  return `${ARCHE_BASE_URL}/permissions`;
}
