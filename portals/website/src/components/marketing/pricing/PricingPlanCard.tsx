"use client";

/**
 * PricingPlanCard — /pricing 档位卡。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * 视觉按定稿样图（v5）：
 * - 年付模式大字展示折合月价（floor(yearly/12)），小字年付总额，success 徽章省额；
 * - 受众行 = 受众标签 + 席位（图标按受众：个人/团队/私有化）；
 * - 推荐档 = 浅品牌边框 + 双层品牌光晕，不抬高、无角标，所有卡顶底齐平；
 * - 推荐档 CTA 用营销层渐变（brand→info），其余 outline。
 */

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@vxture/shared";
import {
  Button,
  Card,
  CardContent,
  Icon,
  StatusBadge,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { buildConsoleSubscribeUrl } from "@/lib/console-entry";
import {
  formatCny,
  yearlySavings,
  type BillingCycle,
  type PlanAudience,
  type PricingPlan,
} from "./pricing-model";

const AUDIENCE_ICON: Record<PlanAudience, IconName> = {
  person: "user",
  team: "users",
  private: "buildings",
};

/** 推荐档：浅品牌边框 + 双层品牌光晕（光晕收在 portal 语义类,引用 --primary token） */
const RECOMMENDED_CARD =
  "border-vx-brand-200 dark:border-vx-brand-500/40 vx-pricing-card-recommended";

/** 营销层渐变 CTA（与首页 hero CTA 同族） */
const GRADIENT_CTA =
  "w-full border-0 bg-linear-to-r from-vx-brand-600 to-vx-info-600 text-vx-white " +
  "hover:from-vx-brand-700 hover:to-vx-info-700";

export function PricingPlanCard({
  plan,
  cycle,
  productCode,
  contactSubject,
}: {
  plan: PricingPlan;
  cycle: BillingCycle;
  productCode: string;
  contactSubject: string;
}) {
  const t = useTranslations("products.subscription");
  const locale = useLocale();
  // 站点 locale 值域即 Locale（zh-CN | en-US），供 shared formatCurrency 使用。
  const appLocale = locale as Locale;

  const isContact = plan.monthly === null || plan.yearly === null;
  const isFree = plan.monthly === 0;
  const isPaid = !isContact && !isFree;

  return (
    <Card
      className={`flex flex-col rounded-2xl shadow-none ${
        plan.highlight
          ? RECOMMENDED_CARD
          : "transition hover:border-vx-brand-200 dark:hover:border-vx-brand-500/30"
      }`}
    >
      <CardContent className="flex flex-1 flex-col p-6">
        {/* 档名/定位语 + 受众图标 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-vx-text-primary">
              {plan.name}
            </p>
            {plan.tagline ? (
              <p className="mt-0.5 text-xs text-vx-text-muted">
                {plan.tagline}
              </p>
            ) : null}
          </div>
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-vx-primary-soft text-vx-primary-strong">
            <Icon
              name={AUDIENCE_ICON[plan.audience]}
              className="h-4 w-4"
              aria-hidden
            />
          </span>
        </div>

        {/* 价格 */}
        <div className="mt-5 flex flex-wrap items-baseline gap-1.5">
          {isContact ? (
            <span className="text-3xl font-semibold tracking-tight text-vx-text-primary">
              {t("price.custom")}
            </span>
          ) : isFree ? (
            <>
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-vx-text-primary">
                {formatCny(0, appLocale)}
              </span>
              <span className="text-xs text-vx-text-muted">
                {t("price.freeForever")}
              </span>
            </>
          ) : cycle === "yearly" ? (
            <>
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-vx-text-primary">
                {formatCny(Math.floor((plan.yearly as number) / 12), appLocale)}
              </span>
              <span className="text-xs text-vx-text-muted">
                {t("price.perMonth")} ·{" "}
                {t("price.yearlyTotal", {
                  amount: formatCny(plan.yearly as number, appLocale),
                })}
              </span>
            </>
          ) : (
            <>
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-vx-text-primary">
                {formatCny(plan.monthly as number, appLocale)}
              </span>
              <span className="text-xs text-vx-text-muted">
                {t("price.perMonth")}
              </span>
            </>
          )}
        </div>

        {/* 省额槽位固定高度，保证各卡分隔线对齐 */}
        <div className="mt-2 min-h-7">
          {isPaid && cycle === "yearly"
            ? (() => {
                const { save, percent } = yearlySavings(
                  plan.monthly as number,
                  plan.yearly as number,
                );
                return (
                  <StatusBadge tone="success">
                    {t("price.saveBadge", {
                      amount: formatCny(save, appLocale),
                      percent,
                    })}
                  </StatusBadge>
                );
              })()
            : null}
        </div>

        {/* 受众 · 席位 */}
        <div className="mt-4 flex items-center gap-2 border-t border-vx-border pt-4 text-sm text-vx-text-muted">
          <Icon
            name={AUDIENCE_ICON[plan.audience]}
            className="h-4 w-4 shrink-0 text-vx-primary"
            aria-hidden
          />
          <span>
            {t(`audience.${plan.audience}`)} · {plan.seats}
          </span>
        </div>

        {/* 功能清单 */}
        <ul className="mt-3 flex-1 space-y-2.5">
          {plan.features.map((feature) => (
            <li
              key={feature}
              className="flex gap-2 text-sm leading-5 text-vx-text-muted"
            >
              <Icon
                name="check"
                className="mt-0.5 h-4 w-4 shrink-0 text-vx-primary"
              />
              <span>{feature}</span>
            </li>
          ))}
        </ul>

        {/* CTA + 脚注 */}
        <div className="mt-6">
          {isContact ? (
            <Button asChild variant="outline" className="w-full">
              <a
                href={`mailto:sales@vxture.com?subject=${encodeURIComponent(
                  contactSubject,
                )}`}
              >
                {t("contact")}
              </a>
            </Button>
          ) : (
            <Button
              asChild
              variant={plan.highlight ? "default" : "outline"}
              className={plan.highlight ? GRADIENT_CTA : "w-full"}
            >
              <a
                href={buildConsoleSubscribeUrl(
                  locale,
                  productCode,
                  "subscribe",
                  plan.tier,
                  // 展示值域 monthly|yearly → wire 值域 month|year
                  // （console 严格匹配 cycle_unit，直传必失配）
                  cycle === "monthly" ? "month" : "year",
                )}
              >
                {isFree ? t("freeCta") : t("subscribe", { plan: plan.name })}
              </a>
            </Button>
          )}
        </div>
        <p className="mt-2.5 text-center text-xs text-vx-gray-400 dark:text-vx-gray-500">
          {isContact
            ? t("note.enterprise")
            : isFree
              ? t("note.free")
              : t("note.paid")}
        </p>
      </CardContent>
    </Card>
  );
}
