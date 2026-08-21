/**
 * locale.types.ts - 语言与本地化类型定义
 * @package @vxture-platform/shared
 * @description 全平台唯一的 Locale 类型及语言展示配置，纯结构类型，无运行时行为
 */

// ============================================================================
// Shared Locale Types
// ============================================================================

/**
 * 全平台唯一的 Locale 类型 - 使用完整的 BCP47 语言标签
 */
export type Locale = "zh-CN" | "en-US";

/**
 * 单个语言的展示配置，用于语言切换列表等 UI 场景
 */
export interface LocaleConfig {
  locale: Locale;
  displayName: string;
  nativeName: string;
  flag?: string;
}
