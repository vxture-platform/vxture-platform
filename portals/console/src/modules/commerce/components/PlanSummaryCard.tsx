"use client";

/**
 * PlanSummaryCard.tsx — 已选套餐只读展示卡。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 「买什么」：档位在上一步（官网定价页 / 深链 target_tier）已经选定，本卡只
 * 陈述结论，不提供二次选择——需要换档回定价页重新进入。卡面走 DS 内建的
 * card 渐变槽（gradient-card-from/to）+ primary-muted 描边，与工作台里的
 * 「品牌强调但非告警」语气一致。
 */

import { useTranslations } from "next-intl";
import { Icon, StatusBadge } from "@vxture/design-system";
import type { SubscribePlanOption } from "@/api/console-bff";

export interface PlanSummaryCardProps {
  readonly productName: string;
  readonly plan: SubscribePlanOption;
  /** 附注（例如「当前为 X，升级立即生效」），无则不渲染。 */
  readonly note?: string | null;
}

const MAX_FEATURE_CHIPS = 5;

export function PlanSummaryCard({
  productName,
  plan,
  note,
}: PlanSummaryCardProps) {
  const t = useTranslations("subscribePage");
  const tFeature = useTranslations("planFeatures");
  // features 是机器键（如 governance.quality）；已知键走字典，未知键如实展示。
  // next-intl 以 . 作路径分隔，键名先转下划线再查。
  const featureLabel = (key: string) => {
    const dictKey = key.replace(/\./g, "_");
    return tFeature.has(dictKey) ? tFeature(dictKey) : key;
  };
  // 部署偏斜防护：门户先于 BFF 发布时旧响应没有 features 字段。
  const features = plan.features as string[] | undefined;
  const chips = (features ?? []).slice(0, MAX_FEATURE_CHIPS);

  return (
    <div className="flex flex-col gap-md rounded-xl border border-primary-muted-hover bg-linear-to-b from-gradient-card-from to-gradient-card-to p-lg">
      <div className="flex items-center gap-md">
        <span
          aria-hidden="true"
          className="flex size-control-lg shrink-0 items-center justify-center rounded-lg bg-primary-muted-hover text-primary-hover"
        >
          <Icon name="package" size="md" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-sm">
            <strong className="truncate text-title-sm text-foreground">
              {productName} · {plan.planName}
            </strong>
            <StatusBadge tone="brand">{plan.tier}</StatusBadge>
          </span>
          {note ? (
            <span className="text-body-sm text-muted-foreground">{note}</span>
          ) : null}
        </span>
      </div>
      {chips.length > 0 ? (
        <ul className="flex flex-wrap gap-xs">
          {chips.map((feature) => (
            <li
              key={feature}
              className="rounded-4xl border border-border bg-card px-sm py-2xs text-body-sm text-muted-foreground"
            >
              {featureLabel(feature)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-sm text-content-tertiary">
          {t("confirm.noFeatures")}
        </p>
      )}
    </div>
  );
}
