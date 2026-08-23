/**
 * types.ts - Content Registry 类型定义
 * @package @vxture/website
 * @layer Presentation
 * @category Content Registry
 * @author AI-Generated
 * @date 2026-05-06
 */

// =============================================================================
// Content 区段标识
// =============================================================================

/**
 * 所有受 Content Registry 管理的 URL 区段。
 * 新增区段：在此处追加 key，同时在 registry.ts 中注册对应 loader。
 */
export type ContentSection =
  | "legal"
  | "blog"
  | "docs"
  | "faq"
  | "support"
  | "insights"
  | "careers"
  | "certifications"
  | "changelog";

export type ContentLayout = "legal" | "article" | "prose";

// =============================================================================
// Content Entry 判别联合
// =============================================================================

export interface LegalIndexEntry {
  type: "legal-index";
  layout: "legal";
}

export interface LegalDetailEntry {
  type: "legal-detail";
  layout: "legal";
  /** next-intl legal namespace 下的 policy key，如 'terms' | 'privacy' */
  policyKey: string;
}

export interface BlogIndexEntry {
  type: "blog-index";
  layout: "article";
}

export interface BlogPostEntry {
  type: "blog-post";
  layout: "article";
  /** 文章 slug，未来由 CMS / MDX 解析为具体内容 */
  slug: string;
}

/** 占位条目，用于尚未实现内容的区段 */
export interface StubEntry {
  type: "stub";
  layout: "prose";
  section: ContentSection;
}

export type ContentEntry =
  | LegalIndexEntry
  | LegalDetailEntry
  | BlogIndexEntry
  | BlogPostEntry
  | StubEntry;

// =============================================================================
// Loader 与 Registry 配置接口
// =============================================================================

/**
 * ContentLoader — 接收剩余 slug 段和 locale，返回内容条目。
 * 返回 null 表示该路径不存在，路由层应触发 notFound()。
 *
 * 今天：从本地数据 / 翻译文件读取
 * 未来：替换为 CMS API 调用 或 MDX 文件系统加载，路由层无需修改
 */
export type ContentLoader = (
  slug: string[],
  locale: string,
) => Promise<ContentEntry | null>;

/**
 * generateStaticParams 返回格式：
 * 每项为「section 之后的」剩余路径段数组
 * 例如 legal 的 staticParams: [[], ['terms'], ['privacy'], ...]
 */
export type ContentStaticParamsGenerator = () =>
  | string[][]
  | Promise<string[][]>;

export interface ContentSectionConfig {
  loader: ContentLoader;
  /**
   * 若未提供，仅生成 section 根路径（如 /faq）。
   * 若提供，返回值与 section 前缀拼接后生成完整静态路径。
   */
  staticParams?: ContentStaticParamsGenerator;
}
