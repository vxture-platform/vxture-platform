"use client";

/* 旧路径兜底 — /runos/audit → /audit/changes
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function RunosAuditRedirect() {
  return (
    <LegacyRedirect
      to="/audit/changes?source=runos"
      title="变更审计"
      description="三个审计面按性质合并：管理变更并入「能力面 · Runos」来源 tab；能力调用与任务反馈两条流是运行事实，去了「运行监控 · 调用日志」。"
    />
  );
}
