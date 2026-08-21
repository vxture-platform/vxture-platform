/**
 * theme.types.ts - Shared theme types
 * @package @vxture-platform/shared
 * @description Pure structural types for theme and dark/light mode, shared across all layers. Contains only structural types without runtime behavior.
 */

// =============================================================================
// Shared Theme Types
// =============================================================================

/**
 * 全平台三档主题类型
 * - light：亮色
 * - dark：暗色
 * - system：跟随操作系统
 */
export type Theme = "light" | "dark" | "system";

/**
 * 扩展主题类型，支持自定义主题标识符（如租户品牌主题）
 * 保留字面量提示，同时允许任意字符串值
 *
 * @example
 * const t: ThemeValue = 'light';         // ✅ 有字面量提示
 * const t: ThemeValue = 'tenant-blue';   // ✅ 自定义主题
 */
export type ThemeValue = Theme | (string & {});
