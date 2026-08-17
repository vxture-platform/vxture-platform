"use client";

/* 旧路径兜底 — /security/rbac → /audit/rbac
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function SecurityRbacRedirect() {
  return (
    <LegacyRedirect
      to="/audit/rbac"
      title="权限管理"
      description="「安全」板块只剩审计与权限两项，直接以「安全审计」为名。"
    />
  );
}
