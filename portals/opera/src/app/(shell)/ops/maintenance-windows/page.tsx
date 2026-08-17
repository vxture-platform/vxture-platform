"use client";

/* 旧路径兜底 — /ops/maintenance-windows → /ops/maintenance
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function MaintenanceWindowsRedirect() {
  return (
    <LegacyRedirect
      to="/ops/maintenance"
      title="维护窗口"
      description="路径与导航名对齐。"
    />
  );
}
