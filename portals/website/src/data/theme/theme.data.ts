/**
 * 站点主题静态配置
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Theme
 */

import type { Theme } from "@vxture-platform/shared";

export interface WebsiteThemeOption {
  value: Theme;
  icon: "globe" | "sun" | "moon";
  labelKey: string;
}

export const WEBSITE_THEME_OPTIONS: readonly WebsiteThemeOption[] = [
  { value: "system", icon: "globe", labelKey: "system" },
  { value: "light", icon: "sun", labelKey: "light" },
  { value: "dark", icon: "moon", labelKey: "dark" },
] as const;

export const WEBSITE_DEFAULT_THEME: Theme = "system";
