/**
 * stub.loader.ts - 占位 Loader 工厂
 * @package @vxture/website
 * @layer Presentation
 * @category Content Registry / Loaders
 * @author AI-Generated
 * @date 2026-05-06
 */

import type { ContentLoader, ContentSection } from "../types";

/**
 * 生成占位 loader：区段根路径，外加**显式声明的**子页。
 *
 * ── 为什么要支持子页（2026-09-08）──
 * 原先只认根路径，子路径一律 `null` → 404。而 console 侧栏的「模型服务 / 技能工具」
 * 要外链到具体文档页（`/docs/models`、`/docs/skills`），落在子路径上——
 * **一个指向 404 的外链比没有外链更糟**：它让人以为文档丢了，而不是还没写。
 *
 * 子页仍是「开发中」占位:**有页面、没内容**，与「没有这个页面」是两回事。
 *
 * ── 为什么是白名单而不是全放行 ──
 * 全放行等于 `/docs/随便什么` 都渲染成占位页，搜索引擎会收录一堆不存在的路径，
 * 打错字也看不出来。只放行声明过的那几条。
 *
 * 升级路径：将某个区段从 stub 换成真实 loader 时，只改 registry.ts 的 entry，
 * 本工厂不变。
 *
 * @param section - Content 区段标识，透传至 StubEntry 供渲染层使用
 * @param pages   - 该区段下允许的子页 slug（单段）。不给则只有根路径。
 */
export function createStubLoader(
  section: ContentSection,
  pages: readonly string[] = [],
): ContentLoader {
  const allowed = new Set(pages);
  return async (slug) => {
    if (slug.length === 0) return { type: "stub", layout: "prose", section };
    // 只认单段、且声明过的子页；更深的路径与未声明的名字一律 404。
    const [first] = slug;
    if (slug.length === 1 && first && allowed.has(first)) {
      return { type: "stub", layout: "prose", section };
    }
    return null;
  };
}
