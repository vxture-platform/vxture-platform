"use client";

/**
 * TeamTiersGhostCard — 「个人」视角下的团队档位占位卡。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * 实底（灰 → brand-muted 渐变）+ 实线边框，表达「还有团队档位放不下」，
 * 点击切到「全部」视角。窄列（栅格里给 minmax(8.5rem, 10rem)）。
 */

import { useTranslations } from "next-intl";
import { Button, Icon } from "@vxture/design-system";
import type { PricingPlan } from "./pricing-model";

export function TeamTiersGhostCard({
  teamPlans,
  onViewAll,
}: {
  teamPlans: PricingPlan[];
  onViewAll: () => void;
}) {
  const t = useTranslations("products.subscription.ghost");
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onViewAll}
      className="flex h-auto flex-col items-center justify-center gap-2.5 whitespace-normal rounded-2xl border border-vx-gray-200 bg-linear-to-b from-vx-gray-50 to-vx-brand-50 p-5 text-center font-normal transition hover:border-vx-brand-300 hover:from-vx-brand-50/60 dark:border-vx-gray-700 dark:from-vx-gray-800 dark:to-vx-brand-950 dark:hover:border-vx-brand-500/40"
    >
      <Icon
        name="users"
        className="h-6 w-6 text-vx-gray-400 dark:text-vx-gray-500"
        aria-hidden
      />
      <span className="text-sm font-medium text-vx-text-primary">
        {t("title")}
      </span>
      <span className="text-xs leading-5 text-vx-text-muted">
        {teamPlans.map((plan) => plan.name).join(" · ")}
      </span>
      <span className="text-xs font-semibold text-vx-brand-600 dark:text-vx-brand-300">
        {t("viewAll")}
      </span>
    </Button>
  );
}
