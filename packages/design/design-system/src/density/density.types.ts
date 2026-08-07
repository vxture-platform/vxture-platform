/**
 * density.types.ts - Density 类型定义
 * @package @vxture/design-system
 *
 * 功能：定义 UI 密度系统的类型
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Types
 */

/**
 * Density 类型的**权威在 @vxture/design-tokens**：密度三档是 T2 的模式轴，
 * 类名与取值由 CSS 侧的 `.density-*` 块决定，两处各写一份必然漂移。
 * 此处只转发，使既有的 `from "../../density"` 引用保持不变。
 */
export type { Density } from "@vxture/design-tokens";
export { DENSITIES, densityClass } from "@vxture/design-tokens";
