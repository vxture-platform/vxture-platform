"use client";

/* 旧路径兜底 — /runos/supply-catalogs → /capability/grants
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function RunosSupplyCatalogsRedirect() {
  return (
    <LegacyRedirect
      to="/capability/grants"
      title="能力授权"
      description="与「路由授权」成对命名；旧路径 supply-catalogs 是上游内部叫法，不是运营者的词。"
    />
  );
}
