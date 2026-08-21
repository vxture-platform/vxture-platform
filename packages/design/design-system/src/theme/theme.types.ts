/**
 * theme.types.ts - 主题系统类型定义
 * @package @vxture/design-system
 *
 * 功能：定义主题系统的类型
 *       Theme 类型在此本地定义，避免 rootDir 跨包引用导致 tsc 报错
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Types
 */

/**
 * 主题模式（与 @vxture-platform/shared 的 Theme 类型保持一致）
 * - light：亮色
 * - dark：暗色
 * - system：跟随操作系统
 */
export type ThemeMode = "light" | "dark" | "system";
export type Theme = "light" | "dark";

/**
 * 单个主题的展示配置，用于主题切换列表渲染
 * isDark 由消费方按需计算，不在此冗余存储
 */
export interface ThemeConfig {
  theme: ThemeMode;
  displayName: string;
  icon?: string;
}
