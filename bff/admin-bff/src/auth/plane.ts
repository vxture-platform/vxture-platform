/**
 * plane.ts — 本 BFF 所属平台的根码。
 * @package @vxture/bff-admin
 * @layer BFF
 *
 * 三个运营平台（admin 运营 / opera 运维 / arche 治理）各有一棵权限树，根码是进入
 * 该平台的门：没有它的运营账号进不了本平台的数据面（owner 2026-09-14，三平台严格
 * 隔离）。根码不手配——seed 与迁移按「持有子节点必持有祖先」闭包自动授予，能做本平台
 * 任一件事的角色都有它。
 *
 * 三个 BFF 各写一份，不共享导入：可以重复，不能耦合。
 */
export const PLANE_ROOT = "admin.plane";

/** 门户读会话与能力码的端点不设门：它们要能回答「你进不了本平台」，而不是跟着一路 403。 */
export const PLANE_GATE_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  "/api/me",
  "/api/capabilities",
]);
