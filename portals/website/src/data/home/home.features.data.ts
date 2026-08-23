/**
 * Features 结构数据 - 不包含翻译文本，只定义结构
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Home
 */

/**
 * 功能特性 CTA 配置
 */
export interface FeatureCta {
  href: string;
}

/**
 * 单个功能特性数据结构
 */
export interface FeatureItem {
  id: string;
  slug: string;
  /** icon 名称从翻译文件（features.json items.*.icon）读取，data 层不再硬编码 */
  icon?: string;
  intent: string;
  theme: string;
  variant: string;
  highlights: string[];
  cta: FeatureCta;
}

/**
 * Features 完整数据结构
 */
export interface FeaturesData {
  enabled: boolean;
  icon: string;
  titleKey: string;
  subtitleKey: string;
  taglineKey: string;
  items: FeatureItem[];
}

/**
 * Features 结构数据 - 使用 labelKey 映射翻译
 */
// 三张卡原先各指 /features/{slug}，而那一族路由从来不存在——三条全是 404
// （2026-08-23 断链审计）。能力介绍没有独立页面，统一收到产品体系总览。
export const FEATURES_DATA: FeaturesData = {
  enabled: true,
  icon: "chart",
  titleKey: "title",
  subtitleKey: "subtitle",
  taglineKey: "tagline",
  items: [
    {
      id: "feature-intro-01",
      slug: "data-knowledge-graph",
      intent: "simulation",
      theme: "primary",
      variant: "card",
      highlights: [
        "items.feature-intro-01.highlights.0",
        "items.feature-intro-01.highlights.1",
        "items.feature-intro-01.highlights.2",
      ],
      cta: {
        href: "/products",
      },
    },
    {
      id: "feature-intro-02",
      slug: "intelligent-decision-dispatch",
      intent: "solution",
      theme: "primary",
      variant: "card",
      highlights: [
        "items.feature-intro-02.highlights.0",
        "items.feature-intro-02.highlights.1",
        "items.feature-intro-02.highlights.2",
      ],
      cta: {
        href: "/products",
      },
    },
    {
      id: "feature-intro-03",
      slug: "digital-twin-simulation",
      intent: "simulation",
      theme: "primary",
      variant: "card",
      highlights: [
        "items.feature-intro-03.highlights.0",
        "items.feature-intro-03.highlights.1",
        "items.feature-intro-03.highlights.2",
      ],
      cta: {
        href: "/products",
      },
    },
  ],
};
