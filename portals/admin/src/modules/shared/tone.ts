/**
 * tone.ts —— admin 侧的语气适配层：把颜色名翻译成 DS 的语义名。
 *
 * 为什么需要这一层：admin 的既有实现（以及 admin-bff 的契约字段，见
 * `CommerceOverviewMetric.tone`）用 `blue|green|amber|rose` 表达语气——**用颜色的名字
 * 说语义**。DS 用 `brand|success|warning|danger`，说的是语义本身。
 *
 * 两边说的其实是同一件事，admin 自己的 CSS 就是证据：
 *
 *   --tenant-blue:  var(--vx-color-auth-accent)   → 品牌色
 *   --tenant-green: var(--success)
 *   --tenant-amber: var(--vx-color-warning-600)
 *   --tenant-rose:  var(--destructive)
 *
 * 所以这不是"把颜色映射成语义"这种有损翻译，是把一直隐含的语义显式写出来。
 *
 * 这一层只为契约字段而留。**前端自己写死的 tone 一律直接写 DS 语义名**，不要绕这里
 * 走一圈——那只会让 `blue` 这套词汇继续活下去。等 admin-bff 的契约把 tone 换成语义名，
 * 本文件即可删除。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Shared
 */

import type { StatusBadgeTone } from "@vxture/design-system";

/** admin-bff 契约里的语气值域（`CommerceOverviewMetric.tone` 等）。 */
export type LegacyColorTone = "blue" | "green" | "amber" | "rose";

const BY_LEGACY: Record<LegacyColorTone, StatusBadgeTone> = {
  blue: "brand",
  green: "success",
  amber: "warning",
  rose: "danger",
};

/** 契约的颜色名 → DS 语义名。认不出的值退到 `neutral`，不猜。 */
export function toStatusTone(tone: LegacyColorTone | string): StatusBadgeTone {
  return BY_LEGACY[tone as LegacyColorTone] ?? "neutral";
}
