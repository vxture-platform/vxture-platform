"use client";

/* 旧路径兜底 — /atlas/audit → /audit/changes
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function AtlasAuditRedirect() {
  return (
    <LegacyRedirect
      to="/audit/changes?source=atlas"
      title="变更审计"
      description="三个审计面按性质合并：管理变更归安全审计（本页并入「模型面 · Atlas」来源 tab），运行事实归运行监控。"
    />
  );
}
