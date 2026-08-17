"use client";

/* 旧路径兜底 — /atlas/product-grants → /model/grants
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function AtlasProductGrantsRedirect() {
  return (
    <LegacyRedirect
      to="/model/grants"
      title="路由授权"
      description="与「能力授权」成对命名：区别在授的是什么，不在授给谁。"
    />
  );
}
