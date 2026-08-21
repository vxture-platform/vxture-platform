/**
 * locale.constants.ts - Shared locale constants
 * @package @vxture-platform/shared
 * @description Global configuration constants for language and localization, shared across all layers. Contains supported locales, default locale, and complete language configurations.
 */

import type { Locale, LocaleConfig } from "../types/locale.types";

// =============================================================================
// 语言枚举定义
// =============================================================================

/**
 * 全平台支持的语言列表
 * @description 这是全平台唯一的语言定义 - 使用完整的 BCP47 标签
 */
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

/**
 * 默认语言
 * @description 全平台统一的默认语言
 */
export const DEFAULT_LOCALE: Locale = "zh-CN";

// =============================================================================
// 语言配置常量
// =============================================================================

/**
 * 语言配置对象，包含完整的语言信息
 * @description 提供语言的显示名称、本地名称、国旗等信息
 */
export const LOCALE_CONFIGS: Record<Locale, LocaleConfig> = {
  "zh-CN": {
    locale: "zh-CN",
    displayName: "简体中文",
    nativeName: "简体中文",
    flag: "🇨🇳",
  },
  "en-US": {
    locale: "en-US",
    displayName: "English",
    nativeName: "English",
    flag: "🇺🇸",
  },
};

/**
 * Locale 的默认货币，调用方未指定货币时使用
 */
export const LOCALE_DEFAULT_CURRENCY: Record<Locale, string> = {
  "zh-CN": "CNY",
  "en-US": "USD",
} as const;

// =============================================================================
// 国际化系统配置
// =============================================================================

/**
 * LOCALE 系统配置常量
 * @description 本地化系统的配置项
 */
export const LOCALE_CONSTANTS = {
  /** localStorage key */
  STORAGE_KEY: "locale-storage",

  /** Cookie key */
  COOKIE_KEY: "NEXT_LOCALE",

  /** HTML lang attribute */
  HTML_LANG_ATTRIBUTE: "lang",
} as const;
