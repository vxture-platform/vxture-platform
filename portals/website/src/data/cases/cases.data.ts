/**
 * 案例库结构数据 - 不包含翻译文本，只定义结构与 i18n key
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Cases
 * @author AI-Generated
 * @date 2026-03-17
 */

// ─── 接口定义 ─────────────────────────────────────────────────────────────────

/**
 * 案例封面配置
 */
export interface CaseCover {
  url: string;
}

/**
 * 案例 CTA 配置
 */
export interface CaseCta {
  href: string;
}

/**
 * 案例结构项（不含翻译文本，文本由 i18n key 提供）
 */
export interface CaseItem {
  /** 案例唯一标识 */
  id: string;
  /** URL 友好标识符 */
  slug: string;
  /** 发布时间 */
  publishedAt: string;
  /** 主题样式 */
  theme: string;
  /** 内容意图 */
  intent: string;
  /** 展示变体 */
  variant: string;
  /** 封面图片 */
  cover: CaseCover;
  /** 案例跳转链接 */
  cta: CaseCta;
}

/**
 * UI 文本配置（使用 i18n key 映射）
 */
export interface CasesUi {
  viewDetailsKey: string;
  prevKey: string;
  nextKey: string;
  filterByKey: string;
  searchKey: string;
  noResultsKey: string;
  clearFiltersKey: string;
  overviewKey: string;
  highlightsKey: string;
}

/**
 * 筛选分类配置
 */
export interface CaseCategory {
  id: string;
  nameKey: string;
  slug: string;
}

/**
 * 案例完整数据结构
 */
export interface CasesData {
  enabled: boolean;
  icon: string;
  titleKey: string;
  subtitleKey: string;
  taglineKey: string;
  ui: CasesUi;
  items: CaseItem[];
  categories: CaseCategory[];
}

// ─── 数据常量 ─────────────────────────────────────────────────────────────────

/**
 * 案例库结构数据 - 所有文本通过 useTranslations('cases') 获取
 */
export const CASES_DATA: CasesData = {
  enabled: true,
  icon: "chart",
  titleKey: "title",
  subtitleKey: "subtitle",
  taglineKey: "tagline",
  ui: {
    viewDetailsKey: "ui.viewDetails",
    prevKey: "ui.prev",
    nextKey: "ui.next",
    filterByKey: "ui.filterBy",
    searchKey: "ui.search",
    noResultsKey: "ui.noResults",
    clearFiltersKey: "ui.clearFilters",
    overviewKey: "ui.overview",
    highlightsKey: "ui.highlights",
  },
  categories: [
    { id: "category-01", nameKey: "categories.geo", slug: "geo" },
    { id: "category-02", nameKey: "categories.public", slug: "public" },
    { id: "category-03", nameKey: "categories.emergency", slug: "emergency" },
  ],
  items: [
    {
      id: "case-intro-01",
      slug: "geo-disaster-graph",
      publishedAt: "2024-03-01",
      theme: "success",
      intent: "case",
      variant: "card",
      cover: { url: "/images/casessection/case-intro-01.jpg" },
      cta: { href: "/cases-pages/geo-disaster-graph" },
    },
    {
      id: "case-intro-02",
      slug: "intelligent-emergency",
      publishedAt: "2024-12-01",
      theme: "brand",
      intent: "new",
      variant: "card",
      cover: { url: "/images/casessection/case-intro-02.jpg" },
      cta: { href: "/cases-pages/intelligent-emergency" },
    },
    {
      id: "case-intro-03",
      slug: "public-safety-analysis",
      publishedAt: "2025-06-01",
      theme: "info",
      intent: "featured",
      variant: "card",
      cover: { url: "/images/casessection/case-intro-03.jpg" },
      cta: { href: "/cases-pages/public-safety-analysis" },
    },
    {
      id: "case-intro-04",
      slug: "environmental-monitoring",
      publishedAt: "2025-09-15",
      theme: "primary",
      intent: "case",
      variant: "card",
      cover: { url: "/images/casessection/case-intro-01.jpg" },
      cta: { href: "/cases-pages/environmental-monitoring" },
    },
    {
      id: "case-intro-05",
      slug: "transportation-simulation",
      publishedAt: "2025-12-01",
      theme: "success",
      intent: "new",
      variant: "card",
      cover: { url: "/images/casessection/case-intro-02.jpg" },
      cta: { href: "/cases-pages/transportation-simulation" },
    },
    {
      id: "case-intro-06",
      slug: "healthcare-intelligent",
      publishedAt: "2026-02-15",
      theme: "info",
      intent: "featured",
      variant: "card",
      cover: { url: "/images/casessection/case-intro-03.jpg" },
      cta: { href: "/cases-pages/healthcare-intelligent" },
    },
  ],
};
