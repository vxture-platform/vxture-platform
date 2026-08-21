/**
 * next-intl 路由配置
 * @package @vxture/website
 * @layer Presentation
 * @category I18n
 */

import { defineRouting } from "next-intl/routing";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@vxture-platform/shared";

export const routing = defineRouting({
  /** 支持的语言列表 */
  locales: SUPPORTED_LOCALES,

  /** 默认语言 */
  defaultLocale: DEFAULT_LOCALE,

  /** 前缀模式 */
  localePrefix: "always",

  /** 备用语言 */
  localeDetection: true,
});

/**
 * 生成静态参数类型
 */
export type LocaleParams = {
  locale: (typeof SUPPORTED_LOCALES)[number];
};
