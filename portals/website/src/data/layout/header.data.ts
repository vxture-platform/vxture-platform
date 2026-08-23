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
 * 二级导航项
 *
 * 每一项都必须有真实落点：还没成稿的挂「待建设」页而不是做成不可点的行——
 * 点了什么都不发生，比给一个说明状态的页面更糟。状态用 `badgeKey` 标出来。
 */
export interface HeaderNavChild {
  key: string;
  icon: IconName;
  labelKey: string;
  descriptionKey: string;
  href: string;
  /** 状态标记（如「开发中」）。不给则不渲染。 */
  badgeKey?: string;
}

/**
 * 一级导航项
 */
export interface HeaderNavItem {
  key: string;
  href: string;
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
    { key: "platform", href: "/", labelKey: "nav.platform" },
    {
      key: "products",
      href: "/products",
      labelKey: "nav.products",
      children: [
        {
          key: "appcenter",
          // DS 的 agent 专用字形（ShellAgentButton 同款）。原先的 app-grid 是
          // 「应用宫格」，与站内别处的用法重复，且没点出智能体这层语义。
          icon: "agent",
          labelKey: "productsMenu.appcenter.label",
          descriptionKey: "productsMenu.appcenter.description",
          href: "/appcenter",
        },
        {
          key: "platform-products",
          icon: "cube",
          labelKey: "productsMenu.platformProducts.label",
          descriptionKey: "productsMenu.platformProducts.description",
          href: "/products",
        },
        {
          key: "industry-scenarios",
          icon: "buildings",
          labelKey: "productsMenu.industryScenarios.label",
          descriptionKey: "productsMenu.industryScenarios.description",
          href: "/industry-scenarios",
          badgeKey: "productsMenu.inDevelopment",
        },
        {
          // 桌面端如影工作台，不是后台管理——控制台入口在右侧工具区，与此无关。
          key: "workbench",
          icon: "desktop",
          labelKey: "productsMenu.workbench.label",
          descriptionKey: "productsMenu.workbench.description",
          href: "/workbench",
          badgeKey: "productsMenu.inDevelopment",
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
