/**
 * registry.ts - Content Registry 主配置
 * @package @vxture/website
 * @layer Presentation
 * @category Content Registry
 * @author AI-Generated
 * @date 2026-05-06
 */

import { legalLoader, legalStaticParams } from "./loaders/legal.loader";
import { blogLoader, blogStaticParams } from "./loaders/blog.loader";
import { createStubLoader } from "./loaders/stub.loader";
import type { ContentSection, ContentSectionConfig } from "./types";

// =============================================================================
// Registry 主配置表
// =============================================================================

/**
 * CONTENT_REGISTRY — 区段标识 → 加载器配置映射
 *
 * 扩展指南：
 *   新增区段：在 types.ts 的 ContentSection 追加 key，在此处注册 loader
 *   接入 CMS：将对应区段的 loader 替换为 CMS 查询函数，其余不变
 *   接入 MDX：将对应区段的 loader 替换为 MDX 文件系统读取函数，其余不变
 */
export const CONTENT_REGISTRY: Record<ContentSection, ContentSectionConfig> = {
  // ── 已实现 ─────────────────────────────────────────────────────────────────
  legal: {
    loader: legalLoader,
    staticParams: legalStaticParams,
  },
  blog: {
    loader: blogLoader,
    staticParams: blogStaticParams,
  },
  // ── 占位实现（原 [footerSlug] 路由收拢至此） ─────────────────────────────
  // docs 之前只在页脚有链接、从未注册 → /docs 一直是 404（2026-08-23 审计发现）。
  docs: { loader: createStubLoader("docs") },
  faq: { loader: createStubLoader("faq") },
  support: { loader: createStubLoader("support") },
  insights: { loader: createStubLoader("insights") },
  careers: { loader: createStubLoader("careers") },
  certifications: { loader: createStubLoader("certifications") },
  // contact 已于 2026-08-22 出栈：/contact 有了真实页面，落在
  // (marketing)/contact 路由上。留在这里会和它撞路由（本 catch-all 是
  // dynamicParams=false 的静态生成，会把 /contact 也预渲染成占位页）。
  changelog: { loader: createStubLoader("changelog") },
};

// =============================================================================
// 工具函数
// =============================================================================

/** 判断字符串是否为已注册的 ContentSection */
export function isContentSection(value: string): value is ContentSection {
  return value in CONTENT_REGISTRY;
}

/**
 * 聚合所有区段的 generateStaticParams，供 Next.js 静态生成使用。
 * 返回格式：{ slug: string[] }[]（含 section 前缀）
 */
export async function aggregateContentStaticParams(): Promise<
  { slug: string[] }[]
> {
  const result: { slug: string[] }[] = [];

  for (const [section, config] of Object.entries(CONTENT_REGISTRY)) {
    if (config.staticParams) {
      const suffixes = await config.staticParams();
      for (const suffix of suffixes) {
        result.push({ slug: [section, ...suffix] });
      }
    } else {
      // 无 staticParams：仅生成区段根路径
      result.push({ slug: [section] });
    }
  }

  return result;
}
