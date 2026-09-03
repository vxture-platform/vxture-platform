"use client";

/**
 * SubscribePage — the product→console conversion deep-link landing, now the
 * "confirm order" surface (product_200 §3.2; product_320 §4.4; 订阅链路 v5 稿).
 *
 * Entry: /subscribe?product=..&intent=subscribe|upgrade|renew|addon[&target_tier][&cycle]
 * Fault-tolerance (arda_303 §2.2): unknown intent/product → degrade to the
 * subscription home. State machine (product_320 + owner 2026-08-20 修订):
 *  - a pending offline order exists → hand off to the payment page panel;
 *  - otherwise the confirm-order layout: 「给谁买（租户/工作区归属）→ 买什么
 *    （已选套餐只读卡，档位来自 target_tier，不再二次选择）→ 买多久（周期）」
 *    + 右栏订单摘要。三卡只留标题不带描述文字。
 *  - 0 元也是订单：free 档不再即时开通，与付费档同路建单进付款页
 *    （付款环节 cashDue=0 自动结清开通）。enterprise (no price rows) →
 *    contact sales. Vouchers stay on the payment page (they attach to an order).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  Banner,
  Button,
  DetailList,
  DetailRow,
  EmptyState,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  cn,
} from "@vxture/design-system";
import { useRouter } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import {
  createSubscriptionOrder,
  fetchSubscribeContext,
  type SubscribeContext,
  type SubscribePlanOption,
  type SubscribePlanPrice,
} from "@/api/console-bff";
import { CyclePicker } from "./components/CyclePicker";
import { OrderFlowStrip } from "./components/OrderFlowStrip";
import { PlanSummaryCard } from "./components/PlanSummaryCard";
import { SECTION_TIGHT, SectionTitle } from "./components/sectionKit";
import { WorkspacePicker } from "./components/WorkspacePicker";

const STATUS_KEYS = new Set([
  "active",
  "trialing",
  "overdue",
  "suspended",
  "expired",
  "cancelled",
]);

type Cycle = "month" | "year";

/** 货币展示统一走 shared formatCurrency（110-locale-layer 指定入口）。 */
function moneyFor(locale: Locale) {
  return (
    amount: string | number,
    currency: string,
    options?: Intl.NumberFormatOptions,
  ): string => {
    const n = typeof amount === "number" ? amount : Number.parseFloat(amount);
    return Number.isFinite(n)
      ? formatCurrency(n, locale, currency, options)
      : String(amount);
  };
}

function priceForCycle(
  plan: SubscribePlanOption,
  cycle: Cycle,
): SubscribePlanPrice | undefined {
  return plan.prices.find((p) => p.cycleUnit === cycle && p.cycleCount === 1);
}

export function SubscribePage() {
  const t = useTranslations("subscribePage");
  const router = useRouter();
  const params = useSearchParams();
  const formatMoney = moneyFor(useLocale() as Locale);

  const query = useMemo(
    () => ({
      product: params.get("product") ?? undefined,
      intent: params.get("intent") ?? undefined,
      targetTier: params.get("target_tier") ?? undefined,
      metric: params.get("metric") ?? undefined,
    }),
    [params],
  );

  // website 深链预选周期（product_321 §6.2）：wire 值域固定 month|year，
  // 非法值静默忽略（默认年付）。
  const cycleParam = params.get("cycle");
  const initialCycle: Cycle =
    cycleParam === "month" || cycleParam === "year" ? cycleParam : "year";

  const [ctx, setCtx] = useState<SubscribeContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<Cycle>(initialCycle); // 深链预选，默认年付（更省）
  // 深链 target_tier 缺席时的兜底选择（正常路径不出现二次选择）。
  const [pickedVersionId, setPickedVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSubscribeContext(query).then((result) => {
      if (cancelled) return;
      // Degrade (arda_303 §2.2 #1): unknown intent/product/failed fetch → home.
      if (!result || result.intent === null || result.product === null) {
        router.replace("/subscription");
        return;
      }
      setCtx(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [query, router]);

  const reload = useCallback(async () => {
    const fresh = await fetchSubscribeContext(query);
    if (fresh) setCtx(fresh);
  }, [query]);

  if (loading || !ctx) {
    return (
      <ViewLayout className="mx-auto w-full max-w-content-base-xl">
        <EmptyState title={t("loading")} />
      </ViewLayout>
    );
  }

  const { intent, product, targetTier, current, pendingOrder, plans } = ctx;
  if (intent === null || product === null) return null;

  // ── 待支付订单：直接引导进付款页（product_321 §6.1）─────────────────────────
  if (pendingOrder) {
    return (
      <ViewLayout className="mx-auto w-full max-w-content-base-xl">
        <ViewHeader
          icon="credit-card"
          title={t("pending.title")}
          description={t("pending.awaiting")}
        />
        <OrderFlowStrip
          stage={pendingOrder.paymentState ?? "pending_payment"}
          times={{ order: pendingOrder.createdAt }}
        />
        <PageSection
          tone="raised"
          level={2}
          title={<SectionTitle icon="clock">{t("pending.title")}</SectionTitle>}
          className={SECTION_TIGHT}
        >
          <DetailList>
            <DetailRow label={t("pending.orderNo")}>
              <span className="font-mono">{pendingOrder.orderNo}</span>
            </DetailRow>
            <DetailRow label={t("plansSection")}>
              {/* 展示名，不是编码：产品主名 · 套餐名（此前渲染 plan_code，客户看到的是
                  「vxtpl-starter」这种机器码）。 */}
              {[pendingOrder.productName, pendingOrder.planName]
                .filter(Boolean)
                .join(" · ") || pendingOrder.planCode}
              {pendingOrder.tier ? ` · ${pendingOrder.tier}` : ""}
            </DetailRow>
            <DetailRow label={t("pending.amount")}>
              {formatMoney(pendingOrder.amount, pendingOrder.currency)} /{" "}
              {t(`cycle.${pendingOrder.cycleUnit}`)}
            </DetailRow>
          </DetailList>
          <div className="flex flex-wrap items-center gap-sm">
            <Button
              onClick={() =>
                router.push(`/subscribe/pay/${pendingOrder.orderId}`)
              }
            >
              {t("pending.goPay")}
            </Button>
            <Button variant="outline" onClick={() => void reload()}>
              {t("actions.refresh")}
            </Button>
          </div>
        </PageSection>
        {error ? <Banner tone="danger" title={error} /> : null}
      </ViewLayout>
    );
  }

  const stateKey = (() => {
    if (!current) return "none";
    if (current.status === "active" && !current.autoRenew) return "renewOff";
    return STATUS_KEYS.has(current.status) ? current.status : "none";
  })();

  const isLive = current?.status === "active" || current?.status === "trialing";

  // ── 套餐解析：target_tier 直达；缺席/无匹配时兜底 ──────────────────────────
  const currentLiveVersionId = isLive && current ? current.planVersionId : null;

  // target_tier 在阶梯中无匹配（网站硬编码 tier 与后台发布不同步时会发生）：
  // 视同未指定，进入档位选择态——绝不静默落到别的档（曾经落到 Free 一键开通）。
  const tierMatched = targetTier
    ? (plans.find((p) => p.tier === targetTier) ?? null)
    : null;
  const tierMissing = Boolean(targetTier) && tierMatched === null;

  // 兜底预选不选当前套餐：同套餐"升级"是付费空操作（服务端同样拒绝）。
  // 阶梯按 TIERS 升序，优先当前档之上的第一档；已是顶档则不预选。
  const fallbackPlan = (() => {
    if (!currentLiveVersionId) return plans[0] ?? null;
    const idx = plans.findIndex(
      (p) => p.planVersionId === currentLiveVersionId,
    );
    return plans[idx + 1] ?? null;
  })();

  const plan: SubscribePlanOption | null =
    (pickedVersionId
      ? (plans.find((p) => p.planVersionId === pickedVersionId) ?? null)
      : null) ??
    tierMatched ??
    (tierMissing ? null : fallbackPlan);

  const showTierFallback = (!targetTier || tierMissing) && plans.length > 1;
  // 选中的就是在用套餐：走「续订」（延长周期，product_330 renew），不再当成付费空操作挡住。
  const isCurrentPlan =
    plan !== null && plan.planVersionId === currentLiveVersionId;

  const isEnterprise = plan !== null && plan.prices.length === 0;
  const price = plan ? priceForCycle(plan, cycle) : undefined;

  // 年付节省额（月价 ×12 − 年价），两个周期价都在才有意义。
  const savings = (() => {
    if (!plan) return null;
    const m = priceForCycle(plan, "month");
    const y = priceForCycle(plan, "year");
    if (!m || !y) return null;
    const save = Number.parseFloat(m.price) * 12 - Number.parseFloat(y.price);
    return save > 0 ? { amount: save, currency: y.currency } : null;
  })();

  // 意图（product_330）：没有订阅 → new；在用且选了别的档 → upgrade；在用且选了同档 → renew（延期）；
  // 已到期/取消 → renew（同档复活；换档时服务端按 new 建新订阅）。
  const orderIntent: "new" | "renew" | "upgrade" = !current
    ? "new"
    : isLive
      ? isCurrentPlan
        ? "renew"
        : "upgrade"
      : "renew";

  const onSubmit = async () => {
    if (!plan || isEnterprise || !price) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createSubscriptionOrder({
        productCode: product.code,
        planVersionId: plan.planVersionId,
        cycleUnit: cycle,
        intent: orderIntent,
        ...(orderIntent !== "new" && current
          ? { upgradeOfSubscriptionId: current.subscriptionId }
          : {}),
      });
      // 0 元也是订单（owner 2026-08-20）：一律进付款页,付款环节消化 ¥0。
      if (result.orderId) {
        router.push(`/subscribe/pay/${result.orderId}`);
        return;
      }
      await reload();
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("orderFailed"));
      setBusy(false);
    }
  };

  const contactSales = () => {
    window.location.href = `mailto:sales@vxture.com?subject=${encodeURIComponent(
      `${product.name} 企业版咨询`,
    )}`;
  };

  const planNote =
    orderIntent === "upgrade" && current
      ? t("confirm.whatUpgradeNote", {
          plan: current.tier ?? current.planCode,
        })
      : null;

  return (
    <ViewLayout className="mx-auto w-full max-w-content-base-xl">
      <ViewHeader
        icon="credit-card"
        title={t("confirm.title")}
        secondary={
          <StatusBadge tone="brand">{t(`title.${intent}`)}</StatusBadge>
        }
        description={t(`hint.${stateKey}`)}
      />

      <OrderFlowStrip stage="ordering" />

      {intent === "addon" ? (
        <Banner tone="info" title={t("addonNotice")} />
      ) : null}

      <div className="flex flex-col gap-md lg:flex-row lg:items-start">
        {/* 左列：给谁买 / 买什么 / 买多久 */}
        <div className="flex min-w-0 flex-1 flex-col gap-md">
          <PageSection
            tone="raised"
            level={2}
            title={
              <SectionTitle icon="user-circle">{t("confirm.who")}</SectionTitle>
            }
            className={SECTION_TIGHT}
          >
            <WorkspacePicker onSwitched={() => void reload()} />
          </PageSection>

          <PageSection
            tone="raised"
            level={2}
            title={
              <SectionTitle icon="package">{t("confirm.what")}</SectionTitle>
            }
            className={SECTION_TIGHT}
          >
            {/* 「返回订阅重选」已去掉（owner 2026-09-03）：本页是从官网定价页 newtab 进来的，
                定价页本来就还开着；而且 NEXT_PUBLIC_WEBSITE_URL 未注入时链接会落到 console 自己的
                /pricing（404，线上实测）。要重选直接回官网那一页。 */}
            {plan ? (
              <PlanSummaryCard
                productName={product.name}
                plan={plan}
                note={planNote}
              />
            ) : plans.length > 0 ? (
              <Banner tone="warning" title={t("confirm.tierUnavailable")} />
            ) : (
              <EmptyState title={t("noPlans")} />
            )}
            {showTierFallback && plans.length > 0 ? (
              <div className="flex flex-wrap items-center gap-sm">
                <span className="text-body-sm text-muted-foreground">
                  {t("confirm.pickTier")}
                </span>
                {plans.map((option) => (
                  <Button
                    key={option.planVersionId}
                    size="xs"
                    variant={
                      option.planVersionId === plan?.planVersionId
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() => setPickedVersionId(option.planVersionId)}
                    className={cn(
                      "rounded-4xl",
                      option.planVersionId === plan?.planVersionId &&
                        "border-primary",
                    )}
                  >
                    {option.planName}
                  </Button>
                ))}
              </div>
            ) : null}
          </PageSection>

          <PageSection
            tone="raised"
            level={2}
            title={
              <SectionTitle icon="calendar">
                {t("confirm.howLong")}
              </SectionTitle>
            }
            className={SECTION_TIGHT}
          >
            <CyclePicker
              value={cycle}
              onChange={(next) => setCycle(next)}
              yearSavings={
                savings
                  ? t("confirm.yearlySave", {
                      // 整数省额不带小数，非整数保留到分——不把 ¥0.11 抹成 ¥0。
                      amount: formatMoney(savings.amount, savings.currency, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 2,
                      }),
                    })
                  : null
              }
            />
            <p className="text-body-sm text-muted-foreground">
              {t("confirm.startNote")}
            </p>
          </PageSection>
        </div>

        {/* 右栏：订单摘要 */}
        <aside className="w-full lg:max-w-panel-sm lg:shrink-0">
          <PageSection
            tone="raised"
            level={2}
            title={
              <SectionTitle icon="receipt">{t("confirm.summary")}</SectionTitle>
            }
            className={SECTION_TIGHT}
          >
            {plan ? (
              <>
                <div className="flex items-baseline justify-between gap-md text-body-md">
                  <span className="text-muted-foreground">
                    {plan.planName} ·{" "}
                    {t(
                      `cycleToggle.${cycle === "month" ? "monthly" : "yearly"}`,
                    )}
                  </span>
                  <span className="font-medium text-foreground tabular-nums">
                    {isEnterprise
                      ? t("confirm.priceOnRequest")
                      : price
                        ? `${formatMoney(price.price, price.currency)} / ${t(`cycle.${price.cycleUnit}`)}`
                        : t("pricePending")}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-md border-t border-dashed border-primary/10 pt-md dark:border-primary/20">
                  <strong className="text-label-lg text-foreground">
                    {t("confirm.total")}
                  </strong>
                  <span className="text-heading-3 text-foreground tabular-nums">
                    {isEnterprise
                      ? "—"
                      : price
                        ? formatMoney(price.price, price.currency)
                        : "—"}
                  </span>
                </div>
                {isEnterprise ? (
                  <>
                    <Button
                      variant="outline"
                      className="w-full"
                      size="xl"
                      onClick={contactSales}
                    >
                      {t("actions.contactSales")}
                    </Button>
                    <p className="text-body-sm text-content-tertiary">
                      {t("confirm.fineEnterprise")}
                    </p>
                  </>
                ) : (
                  <>
                    <Button
                      size="xl"
                      disabled={busy || !price}
                      onClick={() => void onSubmit()}
                      className="w-full border-transparent bg-linear-to-r from-gradient-brand-from to-gradient-brand-to text-primary-foreground hover:brightness-110"
                    >
                      {busy ? t("actions.processing") : t("confirm.submit")}
                    </Button>
                    <p className="text-body-sm text-content-tertiary">
                      {isCurrentPlan
                        ? t("confirm.renewCurrent")
                        : t("confirm.fineOffline")}
                    </p>
                  </>
                )}
              </>
            ) : (
              <EmptyState
                title={plans.length > 0 ? t("confirm.pickTier") : t("noPlans")}
              />
            )}
            {error ? <Banner tone="danger" title={error} /> : null}
          </PageSection>
        </aside>
      </div>
    </ViewLayout>
  );
}
