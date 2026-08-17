"use client";

/* 旧路径兜底 — /observability/logs → /ops/logs
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function ObservabilityLogsRedirect() {
  return (
    <LegacyRedirect
      to="/ops/logs"
      title="调用日志"
      description="Observability 与 Ops 本是同一件事，合并进「运行监控」。"
    />
  );
}
