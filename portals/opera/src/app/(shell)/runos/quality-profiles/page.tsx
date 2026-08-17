"use client";

/* 旧路径兜底 — /runos/quality-profiles → /capability/registry
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function RunosQualityProfilesRedirect() {
  return (
    <LegacyRedirect
      to="/capability/registry"
      title="能力注册"
      description="Quality Profile 要到 M3 才有对象，占位页已撤。"
    />
  );
}
