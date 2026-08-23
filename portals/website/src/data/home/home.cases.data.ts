/**
 * 首页案例展示数据
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Home
 */

/**
 * 首页案例展示项
 */
export interface HomeCaseItem {
  /** 案例唯一标识 */
  id: string;
  /** URL友好的唯一标识符（跟随案例变化） */
  slug: string;
  /** 封面图片URL（统一用英文路径） */
  coverUrl: string;
  /** 发布时间（用于排序） */
  publishedAt: string;
  /** 点击跳转链接（指向案例详情页） */
  href: string;
  /** 展示主题样式 */
  theme: "primary" | "brand" | "success" | "info";
  /** 展示变体 */
  variant: "card" | "list" | "grid";
  /** 内容意图（用于分析） */
  intent: "case" | "featured" | "new" | "popular";
}

/**
 * UI 文本配置（使用 labelKey 映射）
 */
export interface HomeCasesUi {
  viewDetailsKey: string;
}

/**
 * 首页案例完整数据结构
 */
export interface HomeCasesData {
  /** 是否显示该区块 */
  enabled: boolean;
  /** 区块标题翻译key */
  titleKey: string;
  /** 区块副标题翻译key */
  subtitleKey: string;
  /** 底部标语翻译key */
  taglineKey: string;
  /** UI文本配置 */
  ui: HomeCasesUi;
  /** 首页展示的3个案例 */
  items: HomeCaseItem[];
}

/**
 * 首页案例展示数据 - JSON提供，中英文一致
 */
export const HOME_CASES_DATA: HomeCasesData = {
  enabled: true,
  titleKey: "title",
  subtitleKey: "subtitle",
  taglineKey: "tagline",
  ui: {
    viewDetailsKey: "ui.viewDetails",
  },
  items: [
    {
      id: "case-intro-01",
      slug: "geo-disaster-graph",
      coverUrl: "/images/cases/case-intro-01.webp",
      publishedAt: "2024-03-01",
      href: "/cases/geo-disaster-graph",
      theme: "success",
      variant: "card",
      intent: "case",
    },
    {
      id: "case-intro-02",
      slug: "intelligent-emergency",
      coverUrl: "/images/cases/case-intro-02.webp",
      publishedAt: "2024-12-01",
      href: "/cases/intelligent-emergency",
      theme: "brand",
      variant: "card",
      intent: "new",
    },
    {
      id: "case-intro-03",
      slug: "public-safety-analysis",
      coverUrl: "/images/cases/case-intro-03.webp",
      publishedAt: "2025-06-01",
      href: "/cases/public-safety-analysis",
      theme: "info",
      variant: "card",
      intent: "featured",
    },
  ],
};
