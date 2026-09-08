"use client";

/**
 * /skills — 技能工具（租户视角只读；owner 2026-09-08）。
 *
 * ── 现在是占位页，说明白为什么 ──
 * console-bff **还没有 runos 的取数通路**：`atlas.router` 那条已经跑通（S2S 换
 * token 代理到上游、上游 `/tenancy/*` 已按本工作空间的有效授权过滤），技能这一侧
 * 对应的路由还没开。菜单先就位是 owner 的裁定——占位≠无用，让人知道这块存在、
 * 归属在哪，比等它做完再冒出来好。
 *
 * ── 这一页将来展示什么 ──
 * 与「模型服务」同一形状：**本工作空间可用的**技能与工具、各自的额度与用量。
 * 只读。它不回答「谁能用」「怎么配」——那些在运维平面（opera）。
 * 侧栏那个 `Runos` 副名是**供给来源标注，不是入口**：点进来是租户自己的清单，
 * 既不通往 opera，也不通往 Runos 产品本体。
 *
 * 门与「模型服务」同码（`tenant.model.read`）：两者是同一类东西的两个供给方，
 * 拆成两个码会让「能看模型的人看不了技能」，而那不是任何人做过的裁定。
 */

import { useTranslations } from "next-intl";
import {
  Banner,
  EmptyState,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import { CapabilityGate } from "@/features/permissions/CapabilityGate";

function SkillsPage() {
  const t = useTranslations("skillsPage");

  return (
    <ViewLayout>
      <ViewHeader
        icon="stack"
        title={t("title")}
        description={t("description")}
      />

      {/* 明确标「开发中」而不是画一张空表：空表看起来像「你没有任何技能」，
          那是个错误的结论——真相是这一页还没接上取数。 */}
      <Banner
        tone="info"
        title={t("planned.title")}
        description={t("planned.body")}
      />

      <EmptyState
        title={t("empty.title")}
        description={t("empty.description")}
      />
    </ViewLayout>
  );
}

export default function Page() {
  return (
    <CapabilityGate capability="tenant.model.read">
      <SkillsPage />
    </CapabilityGate>
  );
}
