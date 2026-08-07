/**
 * modes.ts - 模式轴的取值与类名（与 T2 的模式块同源）。
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category Tokens
 *
 * ⚠ 本文件由脚本生成，请勿手工编辑。
 *   生成：node scripts/design-tokens/generate-token-ts.mjs
 *   权威：scripts/design-tokens/semantic-policy.mjs
 *
 * 密度与字号是用户偏好轴，由祖先类重定向 T2 变量实现，组件无需感知。
 */

/** 密度三档。CSS 侧对应 spacing-semantic.css 的 `.density-*` 块。 */
export type Density = "compact" | "default" | "comfortable";

export const DENSITIES: readonly Density[] = [
  "compact",
  "default",
  "comfortable",
] as const;

/** 密度类名。default 档写在 `:root` 上，仍给出类名以便显式覆盖父级。 */
export const densityClass = (density: Density): string => `density-${density}`;

/** 字号三档。CSS 侧对应 typography-semantic.css 的 `html.vx-font-*` 块。 */
export type FontSize = "small" | "default" | "large";

export const FONT_SIZES: readonly FontSize[] = [
  "small",
  "default",
  "large",
] as const;

export const fontSizeClass = (size: FontSize): string => `vx-font-${size}`;
