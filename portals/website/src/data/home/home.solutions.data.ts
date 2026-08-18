/**
 * Solutions 结构数据 - 不包含翻译文本，只定义结构
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Home
 */

/**
 * 方案封面配置
 */
export interface SolutionCover {
  url: string;
}

/* 方案背景图片(SolutionBgImage/bgImage)已删——全仓零组件消费的死数据,
 * 且四张 bg-0X.jpg 从未入库。 */

/**
 * 方案 CTA 配置
 */
export interface SolutionCta {
  href: string;
}

/**
 * 单个方案数据结构
 */
export interface SolutionItem {
  id: string;
  slug: string;
  icon: string;
  intent: string;
  theme: string;
  variant: string;
  capabilities: string[];
  cover: SolutionCover;
  cta: SolutionCta;
}

/**
 * UI 文本配置（使用 labelKey 映射）
 */
export interface SolutionsUi {
  viewDetailsKey: string;
  prevKey: string;
  nextKey: string;
}

/**
 * Solutions 完整数据结构
 */
export interface SolutionsData {
  enabled: boolean;
  icon: string;
  titleKey: string;
  subtitleKey: string;
  taglineKey: string;
  featuresTitleKey: string;
  ui: SolutionsUi;
  items: SolutionItem[];
}

/**
 * Solutions 结构数据 - 使用 labelKey 映射翻译
 */
export const SOLUTIONS_DATA: SolutionsData = {
  enabled: true,
  icon: "chart",
  titleKey: "title",
  subtitleKey: "subtitle",
  taglineKey: "tagline",
  featuresTitleKey: "featuresTitle",
  ui: {
    viewDetailsKey: "ui.viewDetails",
    prevKey: "ui.prev",
    nextKey: "ui.next",
  },
  items: [
    {
      id: "solution-intro-01",
      slug: "data-integration-platform",
      icon: "data",
      intent: "solution",
      theme: "primary",
      variant: "grid",
      capabilities: ["data-graph-building", "multi-source-data-fusion"],
      cover: {
        url: "/images/productssection/product-intro-01.jpg",
      },
      cta: {
        href: "/solutions/data-integration-platform",
      },
    },
    {
      id: "solution-intro-02",
      slug: "knowledge-graph-engine",
      icon: "graph",
      intent: "solution",
      theme: "brand",
      variant: "grid",
      capabilities: [
        "data-graph-building",
        "ontology-modeling",
        "fusion-analysis",
      ],
      cover: {
        url: "/images/productssection/product-intro-02.jpg",
      },
      cta: {
        href: "/solutions/knowledge-graph-engine",
      },
    },
    {
      id: "solution-intro-03",
      slug: "intelligent-dispatch-system",
      icon: "dispatch",
      intent: "solution",
      theme: "info",
      variant: "grid",
      capabilities: [
        "intelligent-decision-dispatch",
        "real-time-assessment",
        "incident-response",
      ],
      cover: {
        url: "/images/productssection/product-intro-03.jpg",
      },
      cta: {
        href: "/solutions/intelligent-dispatch-system",
      },
    },
    {
      id: "solution-intro-04",
      slug: "digital-twin-simulation-platform",
      icon: "twin",
      intent: "solution",
      theme: "success",
      variant: "grid",
      capabilities: [
        "digital-twin-simulation",
        "scenario-simulation",
        "predictive-analysis",
      ],
      cover: {
        url: "/images/productssection/product-intro-04.jpg",
      },
      cta: {
        href: "/solutions/digital-twin-simulation-platform",
      },
    },
  ],
};
