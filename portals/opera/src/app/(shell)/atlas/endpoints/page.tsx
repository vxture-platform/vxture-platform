"use client";

/* 旧路径兜底 — /atlas/endpoints → /model/routes
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function AtlasEndpointsRedirect() {
  return (
    <LegacyRedirect
      to="/model/routes"
      title="模型路由"
      description="endpoint 带主用与回退，本就是一条具名路由策略，名字与路径一起改准。"
    />
  );
}
