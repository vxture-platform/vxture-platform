"use client";

/**
 * PricingPlanCard — /pricing 档位卡。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * 视觉按定稿样图（v5 + 选中态修订）：
 * - 年付模式大字展示折合月价（floor(yearly/12)），小字年付总额，success 徽章省额；
 * - 受众行 = 受众标签 + 席位（图标按受众：个人/团队/私有化）；
 * - 选中档 = 强调边框 + 双层品牌光晕 + 渐变 CTA；点击任意卡切换。
 *
 * 2026-08-30 数据改读 DB 真源（GET /api/products/:code/plans）：
 * - 价格按档位**实际挂出**的周期展示：当前周期没价时退到另一周期并明示单位，
 *   而不是把月价当年价；两个周期都没价 = 联系销售；
 * - 「最受欢迎」徽章随 highlight 一起去掉——没有任何数据支撑那个说法；
 * - 功能清单是 plan_components.features 的键，文案走词典、缺词回落键名。
 */

import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@vxture-platform/shared";
import {
  Button,
  Card,
  CardContent,
  Icon,
  StatusBadge,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { TIERS } from "@vxture-platform/shared";
import { buildConsoleSubscribeUrl } from "@/lib/console-entry";
import { usePlanLabels } from "./plan-labels";
import {
  displayedPrice,
  formatPrice,
  monthlyEquivalent,
  yearlySavings,
  UNLIMITED,
  type BillingCycle,
  type PlanAudience,
  type PriceFractionDigits,
  type PricingPlan,
} from "./pricing-model";

const AUDIENCE_ICON: Record<PlanAudience, IconName> = {
  person: "user",
  team: "users",
  private: "buildings",
};

/** 选中档：强调边框 + 双层品牌光晕（光晕收在 portal 语义类，引用 --primary token） */
const SELECTED_CARD =
  "border-vx-brand-500 dark:border-vx-brand-400 vx-pricing-card-selected";

/** 营销层渐变 CTA（与首页 hero CTA 同族） */
const GRADIENT_CTA =
  "w-full border-0 bg-linear-to-r from-vx-brand-600 to-vx-info-600 text-vx-white " +
  "hover:from-vx-brand-700 hover:to-vx-info-700";

export function PricingPlanCard({
  plan,
  cycle,
  productCode,
  contactSubject,
  selected,
  onSelect,
  currentTier = null,
  fractionDigits = 2,
}: {
  plan: PricingPlan;
  cycle: BillingCycle;
  productCode: string;
  contactSubject: string;
  selected: boolean;
  onSelect: () => void;
  /** 整页统一的小数位（priceFractionDigits），所有金额一起 0 位或一起 2 位。 */
  fractionDigits?: PriceFractionDigits;
  /**
   * 登录租户在该产品上的当前档（product-subscriptions）；null = 未登录 / 未订阅。
   * 有值时：当前档 CTA 禁用「当前套餐」，低档禁用「低于当前套餐」，高档 CTA 变
   * 「升级到 X」并以 intent=upgrade 进 console——「升级」从此在定价页看清档位与价格
   * 再下单，而不是被系统替客户挑一档直接结账。
   */
  currentTier?: string | null;
}) {
  const t = useTranslations("products.subscription");
  const labels = usePlanLabels();
  const locale = useLocale();
  // 站点 locale 值域即 Locale（zh-CN | en-US），供 shared formatCurrency 使用。
  const appLocale = locale as Locale;

  const shown = displayedPrice(plan, cycle);
  const isContact = shown === null;
  const isFree = shown !== null && shown.price.amount === 0;
  const isPaid = shown !== null && shown.price.amount > 0;
  // 与当前档的相对位置（五档阶梯 @shared TIERS）；当前档未知或不在阶梯里 → 一律按未订阅。
  const tierRank = (tier: string | null) =>
    tier ? (TIERS as readonly string[]).indexOf(tier) : -1;
  const relation: "none" | "current" | "lower" | "higher" =
    currentTier === null || tierRank(currentTier) < 0 || tierRank(plan.tier) < 0
      ? "none"
      : plan.tier === currentTier
        ? "current"
        : tierRank(plan.tier) < tierRank(currentTier)
          ? "lower"
          : "higher";
  // 省额徽章只在「年付展示 + 两个周期都有价 + 年付真的更便宜」时出现。
  const savings =
    isPaid && shown.unit === "year" && plan.monthly && plan.yearly
      ? yearlySavings(plan.monthly.amount, plan.yearly.amount)
      : null;
  const money = (amount: number) =>
    formatPrice(
      amount,
      shown?.price.currency ?? "CNY",
      appLocale,
      fractionDigits,
    );

  const seatsLabel =
    plan.seats === null
      ? null
      : plan.seats === UNLIMITED
        ? t("seats.unlimited")
        : t("seats.count", { count: plan.seats });

  return (
    <Card
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // CTA 链接/按钮上的回车不劫持（让其正常跳转）
        if ((event.target as HTMLElement).closest("a,button")) return;
        event.preventDefault();
        onSelect();
      }}
      className={`flex cursor-pointer flex-col rounded-2xl shadow-none transition ${
        selected
          ? SELECTED_CARD
          : "hover:border-vx-brand-200 dark:hover:border-vx-brand-500/30"
      }`}
    >
      <CardContent className="flex flex-1 flex-col p-6">
        {/* 档名/描述 + 受众图标 */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-semibold text-vx-text-primary">
              {plan.name}
            </p>
            {plan.description ? (
              <p className="mt-0.5 text-xs text-vx-text-muted">
                {plan.description}
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
                {money(0)}
              </span>
              <span className="text-xs text-vx-text-muted">
                {t("price.freeForever")}
              </span>
            </>
          ) : shown.unit === "year" ? (
            <>
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-vx-text-primary">
                {money(monthlyEquivalent(shown.price.amount))}
              </span>
              <span className="text-xs text-vx-text-muted">
                {t("price.perMonth")} ·{" "}
                {t("price.yearlyTotal", { amount: money(shown.price.amount) })}
              </span>
            </>
          ) : (
            <>
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-vx-text-primary">
                {money(shown.price.amount)}
              </span>
              <span className="text-xs text-vx-text-muted">
                {t("price.perMonth")}
              </span>
            </>
          )}
        </div>

        {/* 省额槽位固定高度，保证各卡分隔线对齐 */}
        <div className="mt-2 min-h-7">
          {savings && savings.save > 0 ? (
            <StatusBadge tone="success">
              {t("price.saveBadge", {
                amount: money(savings.save),
                percent: savings.percent,
              })}
            </StatusBadge>
          ) : null}
        </div>

        {/* 受众 · 席位 */}
        <div className="mt-4 flex items-center gap-2 border-t border-vx-border pt-4 text-sm text-vx-text-muted">
          <Icon
            name={AUDIENCE_ICON[plan.audience]}
            className="h-4 w-4 shrink-0 text-vx-primary"
            aria-hidden
          />
          <span>
            {t(`audience.${plan.audience}`)}
            {seatsLabel ? ` · ${seatsLabel}` : null}
          </span>
        </div>

        {/* 功能清单（plan_components.features） */}
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
              <span>{labels.feature(feature)}</span>
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
          ) : relation === "current" || relation === "lower" ? (
            <Button variant="outline" className="w-full" disabled>
              {relation === "current" ? t("currentPlan") : t("lowerPlan")}
            </Button>
          ) : (
            <Button
              asChild
              variant={selected ? "default" : "outline"}
              className={selected ? GRADIENT_CTA : "w-full"}
            >
              <a
                href={buildConsoleSubscribeUrl(
                  locale,
                  productCode,
                  relation === "higher" ? "upgrade" : "subscribe",
                  plan.tier,
                  // 传实际展示的周期（wire 值域 month|year）：console 严格匹配
                  // plan_prices.cycle_unit，传一个该档没挂价的周期必失配。
                  shown.unit,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                {relation === "higher"
                  ? t("upgradeTo", { plan: plan.name })
                  : isFree
                    ? t("freeCta")
                    : t("subscribe", { plan: plan.name })}
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
