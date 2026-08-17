"use client";

/* 旧路径兜底 — /runos/plugins → /capability/registry
 * 2026-08-14 目录重构（`docs/opera-navigation-design.md` §3）。整串查询参数原样带过去，
 * 理由见 `@/components/LegacyRedirect` 文件头。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function RunosPluginsRedirect() {
  return (
    <LegacyRedirect
      to="/capability/registry"
      title="能力注册"
      description="Plugin 不是资源，是将来提交 Capability 的另一种打包路径，因此不再单列。"
    />
  );
}
