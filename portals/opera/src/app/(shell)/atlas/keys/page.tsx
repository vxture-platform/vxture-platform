"use client";

/* 旧路径兜底 — /atlas/keys → /model/keys
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function AtlasKeysRedirect() {
  return (
    <LegacyRedirect
      to="/model/keys"
      title="调用密钥"
      description="「模型管理」板块改按管理域命名，不再以产品代号 Atlas 作路径前缀。"
    />
  );
}
