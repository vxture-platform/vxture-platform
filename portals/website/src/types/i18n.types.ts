/**
 * i18n 类型定义
 * @package @vxture/website
 * @layer Presentation
 * @category Types
 */

import type { Locale } from "@vxture-platform/shared";

/**
 * 翻译命名空间类型
 */
export type TranslationNamespace =
  | "common"
  | "auth"
  | "home"
  | "pricing"
  | "features"
  | "about"
  | "contact";

/**
 * i18n 配置类型
 */
export interface I18nConfig {
  locale: Locale;
  defaultLocale: Locale;
  supportedLocales: Locale[];
}
