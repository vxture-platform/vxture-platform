/**
 * Header 结构数据 - 不包含翻译文本，只定义结构
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Layout
 */

import type { IconName } from "@vxture/design-system";
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
 * Where a second-level nav entry points.
 *
 * `console` is resolved at render time because the console entry URL carries the
 * current locale and a return-to context; it cannot be a static string here.
 * `planned` renders a non-interactive row with a "planned" badge.
 */
export type HeaderNavTarget =
  | { kind: "route"; href: string }
  | { kind: "console" }
  | { kind: "planned" };

/**
 * 二级导航项
 */
export interface HeaderNavChild {
  key: string;
  icon: IconName;
  labelKey: string;
  descriptionKey: string;
  target: HeaderNavTarget;
}

/**
 * 一级导航项
 *
 * `href: null` renders a plain label with no link — used by the platform name,
 * which is a brand marker in the nav rather than a destination.
 */
export interface HeaderNavItem {
  key: string;
  href: string | null;
  labelKey: string;
  children?: HeaderNavChild[];
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
    { key: "platform", href: null, labelKey: "nav.platform" },
    {
      key: "products",
      href: "/products",
      labelKey: "nav.products",
      children: [
        {
          key: "appcenter",
          icon: "app-grid",
          labelKey: "productsMenu.appcenter.label",
          descriptionKey: "productsMenu.appcenter.description",
          target: { kind: "route", href: "/appcenter" },
        },
        {
          key: "platform-products",
          icon: "cube",
          labelKey: "productsMenu.platformProducts.label",
          descriptionKey: "productsMenu.platformProducts.description",
          target: { kind: "route", href: "/products" },
        },
        {
          key: "industry-products",
          icon: "buildings",
          labelKey: "productsMenu.industryProducts.label",
          descriptionKey: "productsMenu.industryProducts.description",
          target: { kind: "planned" },
        },
        {
          key: "workbench",
          icon: "gauge",
          labelKey: "productsMenu.workbench.label",
          descriptionKey: "productsMenu.workbench.description",
          target: { kind: "console" },
        },
      ],
    },
    { key: "solutions", href: "/solutions", labelKey: "nav.solutions" },
    { key: "cases", href: "/cases", labelKey: "nav.cases" },
    { key: "about", href: "/about", labelKey: "nav.about" },
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
