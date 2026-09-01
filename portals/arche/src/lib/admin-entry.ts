/**
 * admin-entry.ts — 跳转到 admin 的商业授权页面。
 * @package @vxture/opera
 * @layer Presentation
 * @category Navigation
 *
 * "产品发布管理"阶段四（2026-08-12）：opera 只出跳转入口，不重建 admin 现有的
 * grants/price-rules/policies/quotas UI——两段裁决里这块是商业封装层，归 admin
 * （product_100_matrix.md）。跳转不带 portal-context（同 website→console 那套
 * encodePortalContext）：admin 目前没有实现 decodePortalContext 解析，带了也是
 * admin 那边读不到的死参数，不为不存在的能力搭架子。
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

/** admin 的 Atlas 商业页（grants / price-rules / policies / quotas）。 */
export function buildAdminAtlasGrantsUrl(): string {
  return `${ADMIN_BASE_URL}/atlas`;
}

/**
 * admin 的运营角色管理页（`admin.operator_role` 等鉴权表的唯一管理面）。
 *
 * RBAC 不是 opera 的职责——admin 与 opera 的登录鉴权同读一套 `admin.operator_*`
 * 表，但账号开通（凭证/MFA 初始化）与角色权限调整统一收口在 admin，避免两个
 * 门户各开一套写路径改同一张鉴权表。opera 只出跳转入口。
 */
export function buildAdminRolesUrl(): string {
  return `${ADMIN_BASE_URL}/admin-roles`;
}

/** admin 的运营权限策略页。 */
export function buildAdminPermissionsUrl(): string {
  return `${ADMIN_BASE_URL}/admin-permissions`;
}
