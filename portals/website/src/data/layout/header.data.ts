/**
 * Header 结构数据 - 不包含翻译文本，只定义结构
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Layout
 */

import type { Locale } from "@vxture-platform/shared";

/**
 * Logo 配置
 */
export interface HeaderLogo {
  image: string;
  href: string;
  labelKey: string;
  altKey: string;
}

/**
 * 导航菜单项
 */
export interface HeaderNavItem {
  href: string;
  labelKey: string;
}

/**
 * 行动按钮配置
 */
export interface HeaderAction {
  href: string;
  variant: "primary" | "secondary";
  labelKey: string;
}

/**
 * 语言切换配置
 */
export interface HeaderLanguage {
  enabled: boolean;
  icon: string;
  titleKey: string;
  options: Array<{
    code: Locale;
    labelKey: string;
  }>;
}

/**
 * 主题切换配置
 */
export interface HeaderTheme {
  enabled: boolean;
  icon: string;
  titleKey: string;
  options: Array<{
    code: "system" | "light" | "dark";
    labelKey: string;
  }>;
}

/**
 * Header 完整数据结构
 */
export interface HeaderData {
  enabled: boolean;
  logo: HeaderLogo;
  nav: HeaderNavItem[];
  actions: HeaderAction[];
  language: HeaderLanguage;
  theme: HeaderTheme;
}

/**
 * Header 结构数据 - 使用 labelKey 映射翻译
 */
export const HEADER_DATA: HeaderData = {
  enabled: true,
  logo: {
    image: "/brand/vxture-logo-white.png",
    href: "/",
    labelKey: "logo.text",
    altKey: "logo.alt",
  },
  nav: [
    { href: "/appcenter", labelKey: "nav.appcenter" },
    { href: "/products", labelKey: "nav.products" },
    { href: "/solutions", labelKey: "nav.solutions" },
    { href: "/cases", labelKey: "nav.cases" },
    { href: "/about", labelKey: "nav.about" },
  ],
  actions: [
    { href: "/signin", variant: "secondary", labelKey: "actions.signup" },
    { href: "/signin", variant: "primary", labelKey: "actions.login" },
  ],
  language: {
    enabled: true,
    icon: "globe",
    titleKey: "language.title",
    options: [
      { code: "zh-CN", labelKey: "language.zh-CN" },
      { code: "en-US", labelKey: "language.en-US" },
    ],
  },
  theme: {
    enabled: true,
    icon: "sun",
    titleKey: "theme.title",
    options: [
      { code: "system", labelKey: "theme.system" },
      { code: "light", labelKey: "theme.light" },
      { code: "dark", labelKey: "theme.dark" },
    ],
  },
};
