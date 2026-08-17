"use client";

/* 过渡页下线 — /audit/runos → /audit/changes?source=runos
 * 2026-08-14 三个审计面按性质合并（`docs/opera-navigation-design.md` §5）。
 * B2 时这页作为过渡停在 `/audit/*` 且不进导航，B3 折进变更审计的来源 tab。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function RunosAuditRedirect() {
  return (
    <LegacyRedirect
      to="/audit/changes?source=runos"
      title="变更审计"
      description="Runos 的管理变更流已并入变更审计的「能力面 · Runos」来源 tab。另外两条流（能力调用、任务反馈）是运行事实不是问责数据，迁到「运行监控 · 调用日志」。"
      icon="clipboard"
    />
  );
}
