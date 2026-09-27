"use client";

/**
 * PricingPlanCard — /pricing 档位卡。
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * 视觉按定稿样图（v5 + 选中态修订）：
 * - 年付模式大字展示**年付总额「/ 年」**（要支付的数），小字「约 xx / 月」作比较参考，success 徽章省额
 *   （2026-09-03 改：此前大字是折合月价，会被当成按月付的数）；¥0 档同样按周期标「/ 月」「/ 年」，不写「永久免费」；
 * - 受众行 = 受众标签 + 席位（图标按受众：个人/团队/私有化）；
 * - 选中档 = 强调边框 + 双层品牌光晕 + 渐变 CTA；点击任意卡切换。
 *
 * 2026-08-30 数据改读 DB 真源（GET /api/products/:code/plans）：
 * - 价格按档位**实际挂出**的周期展示：当前周期没价时退到另一周期并明示单位，
 *   而不是把月价当年价；两个周期都没价 = 联系销售；
 * - 「最受欢迎」徽章随 highlight 一起去掉——没有任何数据支撑那个说法；
 * - 功能清单是 plan_components.features 的键，文案走词典、缺词回落键名。
 *
 * 2026-09-27 两档「不给换档」：停售（sunset）每张卡的 CTA 换成状态字「停售中」+ 副行
 * 「现有订阅不受影响」；冻结中（suspensionState）高档不再给「升级到 X」，改成目录卡
 * 同款的冻结态字样。两者都只收购买 / 升级入口，「当前套餐 / 低于当前套餐」照旧标出。
 *
 * 同日再加一档：升级维护中（产品级维护窗口 `maintenance`）——每张卡的 CTA 换成状态字
 * 「升级维护中，暂不可订阅」+ 副行「预计 … 恢复」，形态照 sunset 那套；优先级高于停售
 * 与冻结（临时运行态先说）。同样只收购买 / 升级 / 联系销售入口。
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
import {
  buildConsoleOrderStatusUrl,
  buildConsoleSubscribeUrl,
} from "@/lib/console-entry";
import {
  maintenanceUntilText,
  type ProductMaintenance,
} from "@/api/product-catalog.api";
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

/** BFF suspensionState 的值域；认不得的值落到最中性的 paused，不让键名冒出来。 */
const SUSPENSION_STATES: ReadonlySet<string> = new Set([
  "maintenance",
  "review",
  "restricted",
  "paused",
]);

/** 定价页需要知道的在途单：去哪看（orderId）、是哪一档（tier）。 */
export interface PendingOrderRef {
  orderId: string;
  tier: string | null;
}

export function PricingPlanCard({
  plan,
  cycle,
  productCode,
  contactSubject,
  selected,
  onSelect,
  currentTier = null,
  pendingOrder = null,
  fractionDigits = 2,
  sunset = false,
  suspensionState = null,
  maintenance = null,
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
  /**
   * 同产品进行中的订单（owner 2026-09-27）。有值时：订单那一档 CTA 变「查看订单状态」
   * 直达 console 的订单状态页，其余档禁用「已有订单进行中」——一产品同时只能有一张
   * 在途单（uidx_orders_open_per_product），再点「订阅」只会在 console 撞 409。
   */
  pendingOrder?: PendingOrderRef | null;
  /**
   * 停售中（承诺等级 sunset，2026-09-27）：阶梯留给老客户参考，但每张卡的购买 / 升级 /
   * 联系销售入口都换成状态字「停售中」——不接新订阅，也不给已订阅的换档。
   */
  sunset?: boolean;
  /**
   * 登录租户在该产品上的冻结态（maintenance / review / restricted / paused）；null = 未冻结。
   * 有值时高档不再给「升级到 X」：换档会改动那条被平台冻结的订阅，等于客户自己解了冻。
   * 目录卡早就这么做（BFF 的 canUpgrade 冻结中恒 false），这一页此前只读 currentTier。
   */
  suspensionState?: string | null;
  /**
   * 产品级升级维护窗口（owner 2026-09-27）；null = 不在维护中。有值时购买 / 升级 / 联系
   * 销售入口都换成状态字「升级维护中，暂不可订阅」，脚注写「预计 … 恢复」。优先于停售与
   * 冻结态；「当前套餐 / 低于当前套餐」与在途单的「查看订单状态」照旧。
   */
  maintenance?: ProductMaintenance | null;
}) {
  const t = useTranslations("products.subscription");
  /* 冻结态的词与目录卡同一份（products.catalog.suspension.*）：同一个状态在两页不该有两套叫法。 */
  const tCatalog = useTranslations("products.catalog");
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
  const frozenLabel = suspensionState
    ? tCatalog(
        `suspension.${SUSPENSION_STATES.has(suspensionState) ? suspensionState : "paused"}`,
      )
    : null;
  /* 停售：一段状态字而不是灰按钮——这里没有「等一等就能点」的动作。它替换的是购买 /
     升级 / 联系销售三种入口，所以在下面出现两次；isContact 仍留在链首，TS 靠它把
     shown 收窄成非 null。 */
  const sunsetNotice = sunset ? (
    <p className="flex h-10 items-center justify-center text-sm font-medium text-vx-text-muted">
      {t("sunset")}
    </p>
  ) : null;
  /* 升级维护中：同一形态的状态字。维护 > 停售——两者都只是把入口换成一句话，维护是
     临时运行态先说它；停售那句等窗口关了自然又露出来。 */
  const maintenanceNotice = maintenance ? (
    <p className="flex h-10 items-center justify-center text-center text-sm font-medium text-vx-text-muted">
      {t("maintenance")}
    </p>
  ) : null;
  const notice = maintenanceNotice ?? sunsetNotice;
  const maintenanceUntil = maintenanceUntilText(maintenance, locale);
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
      {/* 卡内上下留白收一档（owner 2026-09-03：权益多把卡撑高、页面超一屏） */}
      <CardContent className="flex flex-1 flex-col px-5 py-4">
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

        {/* 价格。年付：主数字 = 年付总额「/ 年」（真正要支付的数），小字「约 xx / 月」只是
            比较参考——此前主数字是折合月价，会让人误以为按月付这个数（owner 2026-09-03）。 */}
        <div className="mt-4 flex flex-wrap items-baseline gap-1.5">
          {isContact ? (
            <span className="text-3xl font-semibold tracking-tight text-vx-text-primary">
              {t("price.custom")}
            </span>
          ) : isFree ? (
            <>
              {/* ¥0 也是按周期订阅、会到期的档，标「/ 月」「/ 年」，不写「永久免费」
                  （owner 2026-09-03：不要超出批准做商业承诺）。 */}
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-vx-text-primary">
                {money(0)}
              </span>
              <span className="text-xs text-vx-text-muted">
                {shown.unit === "year"
                  ? t("price.perYear")
                  : t("price.perMonth")}
              </span>
            </>
          ) : shown.unit === "year" ? (
            <>
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-vx-text-primary">
                {money(shown.price.amount)}
              </span>
              <span className="text-xs text-vx-text-muted">
                {t("price.perYear")} ·{" "}
                {t("price.monthlyApprox", {
                  amount: money(monthlyEquivalent(shown.price.amount)),
                })}
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
        <div className="mt-1.5 min-h-6">
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
        <div className="mt-3 flex items-center gap-2 border-t border-vx-border pt-3 text-sm text-vx-text-muted">
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
        <ul className="mt-2.5 flex-1 space-y-2">
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
        <div className="mt-4">
          {isContact ? (
            (notice ?? (
              <Button asChild variant="outline" className="w-full">
                <a
                  href={`mailto:sales@vxture.com?subject=${encodeURIComponent(
                    contactSubject,
                  )}`}
                >
                  {t("contact")}
                </a>
              </Button>
            ))
          ) : pendingOrder ? (
            pendingOrder.tier === plan.tier ? (
              <Button
                asChild
                variant={selected ? "default" : "outline"}
                className={selected ? GRADIENT_CTA : "w-full"}
              >
                <a
                  href={buildConsoleOrderStatusUrl(
                    locale,
                    pendingOrder.orderId,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("pendingOrder.view")}
                </a>
              </Button>
            ) : (
              <Button variant="outline" className="w-full" disabled>
                {t("pendingOrder.blocked")}
              </Button>
            )
          ) : relation === "current" || relation === "lower" ? (
            <Button variant="outline" className="w-full" disabled>
              {relation === "current" ? t("currentPlan") : t("lowerPlan")}
            </Button>
          ) : maintenanceNotice ? (
            /* 升级维护中压过冻结态与停售：产品级的临时运行态先说。 */
            maintenanceNotice
          ) : frozenLabel ? (
            /* 冻结中：与「当前套餐」同一种禁用态，字样换成冻结态（维护中 / 审核中 / …）。
               不给「升级到 X」——换档会动那条被平台冻结的订阅。 */
            <Button variant="outline" className="w-full" disabled>
              {frozenLabel}
            </Button>
          ) : (
            (sunsetNotice ?? (
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
            ))
          )}
        </div>
        <p className="mt-2 text-center text-xs text-vx-gray-400 dark:text-vx-gray-500">
          {/* 维护中的脚注先于其它：预计恢复时间；运营没填（或解析不了）就只说服务暂时不可用。 */}
          {maintenance
            ? maintenanceUntil
              ? t("maintenanceUntil", { time: maintenanceUntil })
              : tCatalog("suspension.hint")
            : isContact && !sunset
              ? t("note.enterprise")
              : pendingOrder
                ? t("note.pendingOrder")
                : frozenLabel
                  ? tCatalog("suspension.hint")
                  : sunset
                    ? t("sunsetHint")
                    : isFree
                      ? t("note.free")
                      : t("note.paid")}
        </p>
      </CardContent>
    </Card>
  );
}
