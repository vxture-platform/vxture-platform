"use client";

/* 旧路径兜底 — /products → /product/catalog
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function ProductsRedirect() {
  return (
    <LegacyRedirect
      to="/product/catalog"
      title="产品目录"
      description="产品管理拆成目录 / 接入凭据 / 权益配置三页，本页是其中的目录。"
    />
  );
}
