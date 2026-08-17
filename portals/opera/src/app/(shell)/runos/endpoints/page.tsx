"use client";

/* 旧路径兜底 — /runos/endpoints → /capability/endpoints
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function RunosEndpointsRedirect() {
  return (
    <LegacyRedirect
      to="/capability/endpoints"
      title="能力端点"
      description="端点嵌在能力里面，没有独立的顶级列表；本页只解释这件事。"
    />
  );
}
