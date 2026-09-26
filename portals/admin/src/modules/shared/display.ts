/**
 * display.ts —— admin 的展示文案约定。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Shared
 */

/**
 * 详情字段的空值占位。
 *
 * 原先藏在各详情页私有的 `DetailField` 里（`{value || "未设置"}`），于是调用点分成
 * 两派：一派靠组件兜底，一派自己写 `?? "未设置"`（BillingDetailPage 与
 * OrderDetailPage 都有）。换成 DS 的 `DetailRow` 后组件不再兜底，兜底就得显式——
 * 顺带把两派统一了。
 *
 * 不进 DS：占位文案是产品语汇（admin 说"未设置"，别处可能说"—"或留空），
 * DS 收了就得替所有产品选词。
 */
export const UNSET_LABEL = "未设置";

export function orUnset(value: string | null | undefined): string {
  return value || UNSET_LABEL;
}

/**
 * 这个值是不是"没有值"。
 *
 * 列表里要用：缺失值若照主信息的深色粗体渲染，读起来跟真值一样重
 * （owner 2026-08-06 在订单列表实测）。上游有时已经把空值投影成了字面量
 * "未设置"，所以既认空也认这个词。
 */
export function isUnset(value: string | null | undefined): boolean {
  return !value || value === UNSET_LABEL;
}

/**
 * 席位上限文案。**null 是「读不到」，不是 0。**
 *
 * 订阅列表页与详情页都显示这个数，所以口径只留一份。它此前是 admin-bff 里写死的
 * `maxUsers: 0`（注释写着「新库无独立列 → 兜底」），于是两处都显示「0 席位」——
 * 一个假装是事实的死值。接上真值之后三种情形要分开：
 *   读不到 → 未设置；-1 → 无限（目录的无限哨兵）；其余 → 数字。
 *
 * `orUnset` 在这里帮不上忙：`${0} 人` 是个非空字符串，它永远不会触发。
 */
export function seatLimitLabel(seatMax: number | null): string {
  if (seatMax === null) return UNSET_LABEL;
  if (seatMax === -1) return "无限";
  return `${seatMax} 人`;
}
