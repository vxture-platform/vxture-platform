/**
 * next-intl 路由配置
 *
 * @package @vxture/console
 * @layer Presentation
 * @category I18n
 * @author AI-Generated
 * @date 2026-05-05
 */

import { defineRouting } from "next-intl/routing";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@vxture-platform/shared";

export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  localeDetection: true,
});

export type LocaleParams = {
  locale: (typeof SUPPORTED_LOCALES)[number];
};
