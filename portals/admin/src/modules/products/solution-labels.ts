"use client";

/**
 * solution-labels.ts —— 解决方案 / 服务套餐四页共用的值域文案与状态机镜像。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Products
 *
 * 2026-08-31 去 mock（TD-029）后，方案的状态是 product.solutions 的四态、档位是
 * @shared 的五档。四个页面各写一份 label 函数会再抄四遍；文案从这里经 `t()` 出。
 *
 * `SOLUTION_STATE_TRANSITIONS` 与 admin-bff products.router 的同名表互为镜像：
 * 它决定菜单里出现哪几个动作，但挡不住任何东西——真正的约束在 BFF。
 */

import { useTranslations } from "next-intl";
import type { IconName } from "@vxture/design-system";
import type {
  ProductSolutionCapabilitySource,
  ProductSolutionCapabilityType,
  ProductSolutionStatus,
  ProductSolutionTier,
  ProductSolutionTierCode,
  ProductSolutionVisibility,
} from "@/entities/console";

export const SOLUTION_STATUSES: readonly ProductSolutionStatus[] = [
  "draft",
  "active",
  "inactive",
  "deprecated",
];

export const SOLUTION_STATE_TRANSITIONS: Record<
  ProductSolutionStatus,
  readonly ProductSolutionStatus[]
> = {
  draft: ["active", "deprecated"],
  active: ["inactive", "deprecated"],
  inactive: ["active", "deprecated"],
  deprecated: [],
};

/** kebab-case 可视码；与 BFF `SOLUTION_CODE_RE` 一致。 */
export const SOLUTION_CODE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function capabilityTypeIcon(
  type: ProductSolutionCapabilityType,
): IconName {
  if (type === "platform") return "database";
  if (type === "agent") return "agent";
  if (type === "model") return "cloud";
  if (type === "data") return "table";
  return "server";
}

export function useSolutionLabels() {
  const t = useTranslations("productCatalog");
  return {
    status: (status: ProductSolutionStatus) => t(`status.${status}`),
    visibility: (visibility: ProductSolutionVisibility) =>
      t(`visibility.${visibility}`),
    capabilityType: (type: ProductSolutionCapabilityType) =>
      t(`capabilityType.${type}`),
    source: (source: ProductSolutionCapabilitySource) => t(`source.${source}`),
    tier: (tier: ProductSolutionTierCode) => t(`tier.${tier}`),
    priceKind: (kind: ProductSolutionTier["priceKind"]) =>
      t(`priceKind.${kind}`),
    /** 状态迁移动作的动词（启用 / 停用 / 退役）。 */
    transition: (to: ProductSolutionStatus) => t(`transition.${to}`),
  };
}
