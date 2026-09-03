/**
 * legal.loader.ts - Legal 内容加载器
 * @package @vxture/website
 * @layer Presentation
 * @category Content Registry / Loaders
 * @author AI-Generated
 * @date 2026-05-06
 */

import type { ContentLoader } from "../types";

// =============================================================================
// 合法 Policy Key 集合
// =============================================================================

const POLICY_KEYS = [
  "terms",
  "privacy",
  "copyright",
  "brand",
  "cookies",
  "refund",
] as const;

type PolicyKey = (typeof POLICY_KEYS)[number];

function isPolicyKey(value: string): value is PolicyKey {
  return (POLICY_KEYS as readonly string[]).includes(value);
}

// =============================================================================
// Loader 实现
// =============================================================================

/**
 * Legal loader：处理 /legal（列表）和 /legal/[policy]（详情）
 *
 * 今天：内容来自 next-intl 翻译文件（legal namespace）
 * 未来：可替换为 CMS 接口，仅需修改此文件，路由层和 registry 不变
 */
export const legalLoader: ContentLoader = async (slug) => {
  // /legal（无子路径）→ 政策列表
  if (slug.length === 0) {
    return { type: "legal-index", layout: "legal" };
  }

  // /legal/[policy]（单政策详情）
  const [policyKey] = slug;
  if (slug.length === 1 && policyKey && isPolicyKey(policyKey)) {
    return { type: "legal-detail", layout: "legal", policyKey };
  }

  return null;
};

// =============================================================================
// Static Params
// =============================================================================

/**
 * 生成 legal 区段的所有静态路径后缀：
 * [[], ['terms'], ['privacy'], ['copyright'], ['brand'], ['cookies'], ['refund']]
 */
export function legalStaticParams(): string[][] {
  return [[], ...POLICY_KEYS.map((key) => [key])];
}
