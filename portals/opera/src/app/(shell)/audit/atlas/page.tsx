"use client";

/* 过渡页下线 — /audit/atlas → /audit/changes?source=atlas
 * 2026-08-14 三个审计面按性质合并（`docs/opera-navigation-design.md` §5）。
 * B2 时这页作为过渡停在 `/audit/*` 且不进导航，B3 折进变更审计的来源 tab。 */

import { LegacyRedirect } from "@/components/LegacyRedirect";

export default function AtlasAuditRedirect() {
  return (
    <LegacyRedirect
      to="/audit/changes?source=atlas"
      title="变更审计"
      description="Atlas 变更流水已并入变更审计的「模型面 · Atlas」来源 tab——三处记的是同一个问题「谁改了什么」，一次追溯不该先知道记录躺在哪个产品的库里。表结构原样保留，没有做字段合并。"
      icon="clipboard"
    />
  );
}
