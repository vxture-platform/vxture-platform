"use client";

/* 旧路径兜底 — /atlas/models → /model/services
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function AtlasModelsRedirect() {
  return (
    <LegacyRedirect
      to="/model/services"
      title="模型服务"
      description="模型注册表已与 Provider 合并到同一张表：Provider 是一级，它名下的模型展开可见。"
    />
  );
}
