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
import {
  formatCurrency,
  isTierUpgrade,
  type Locale,
} from "@vxture-platform/shared";
import {
  Banner,
  Button,
  DetailList,
  DetailRow,
  EmptyState,
  Icon,
  StatusBadge,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  ViewHeader,
  ViewLayout,
  cn,
} from "@vxture/design-system";
import { useRouter } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import {
  createSubscriptionOrder,
  fetchUpgradeQuote,
  type UpgradeQuote,
  fetchSubscribeContext,
  type SubscribeContext,
  type SubscribePlanOption,
  type SubscribePlanPrice,
} from "@/api/console-bff";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { CyclePicker } from "./components/CyclePicker";
import { OrderFlowStrip } from "./components/OrderFlowStrip";
import { useCountdown } from "./components/pay/useCountdown";
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

/**
 * 升级折抵摘要（product_330 §4.1）：自取报价，显示「升级折抵 / 应付合计 / 溢出提示」。
 * 独立组件是因为 SubscribePage 在派生出套餐与周期之前有早退，hook 不能放在那之后。
 */
function UpgradeQuoteSummary({
  subscriptionId,
  planVersionId,
  cycle,
  fallbackTotal,
}: {
  subscriptionId: string;
  planVersionId: string;
  cycle: Cycle;
  /** 报价未到 / 失败时显示的标价 */
  fallbackTotal: string;
}) {
  const t = useTranslations("subscribePage");
  const formatMoney = moneyFor(useLocale() as Locale);
  const [quote, setQuote] = useState<UpgradeQuote | null>(null);
  /* 三态(批 1c):试算中 / 失败(说出来 + 重试)/ 成功。此前失败静默回 null,页面把
   * 「没算出来」显示成「没折抵」的原价。 */
  const [quoteState, setQuoteState] = useState<"loading" | "failed" | "ready">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setQuote(null);
    setQuoteState("loading");
    fetchUpgradeQuote({
      subscriptionId,
      planVersionId,
      cycleUnit: cycle,
    })
      .then((q) => {
        if (!alive) return;
        setQuote(q);
        setQuoteState("ready");
      })
      .catch(() => {
        if (alive) setQuoteState("failed");
      });
    return () => {
      alive = false;
    };
  }, [subscriptionId, planVersionId, cycle, attempt]);

  return (
    <>
      {quoteState === "failed" ? (
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <span className="text-body-sm text-warning-text">
            {t("confirm.creditFailed")}
          </span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t("confirm.creditRetry")}
          </Button>
        </div>
      ) : null}
      {quote && Number(quote.credit) > 0 ? (
        <div className="flex flex-col gap-2xs">
          <div className="flex items-baseline justify-between gap-md text-body-md">
            <span className="text-muted-foreground">{t("confirm.credit")}</span>
            <span className="font-medium text-foreground tabular-nums">
              −{formatMoney(quote.credit, quote.currency)}
            </span>
          </div>
          <p className="text-body-sm text-muted-foreground">
            {t("confirm.creditNote", {
              days: quote.daysLeft,
              usage: Math.round(quote.usageRemainingRatio * 100),
            })}
          </p>
        </div>
      ) : null}
      <div className="flex items-baseline justify-between gap-md border-t border-dashed border-primary/10 pt-md dark:border-primary/20">
        <strong className="text-label-lg text-foreground">
          {t("confirm.total")}
        </strong>
        <span className="text-heading-3 text-foreground tabular-nums">
          {quote
            ? formatMoney(quote.payable, quote.currency)
            : quoteState === "loading"
              ? t("confirm.creditPending")
              : fallbackTotal}
        </span>
      </div>
      {quote && Number(quote.leftover) > 0 ? (
        <p className="text-body-sm text-muted-foreground">
          {t("confirm.leftoverNote", {
            amount: formatMoney(quote.leftover, quote.currency),
          })}
        </p>
      ) : null}
    </>
  );
}

export function SubscribePage() {
  const t = useTranslations("subscribePage");
  const tLoad = useTranslations("loadState");
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
  /* 读失败显影(批 1c):读上下文失败 = 横幅 + 重试;未知产品 / 意图 = 跳回总览
   * (带说明)。此前两者都静默 replace 到 /subscription。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [cycle, setCycle] = useState<Cycle>(initialCycle); // 深链预选，默认年付（更省）
  // 深链 cycle 变了(同页换参)也要跟着变;此前只在挂载时取一次。
  useEffect(() => {
    setCycle(initialCycle);
  }, [initialCycle]);
  // 深链 target_tier 缺席时的兜底选择（正常路径不出现二次选择）。
  const [pickedVersionId, setPickedVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 自动续费 opt-in（owner 2026-09-03）：新订默认关；续订/升级按客户现有设置预填
  // （有 current 即非 new，见下方 orderIntent 推导）。
  const [autoRenew, setAutoRenew] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    fetchSubscribeContext(query)
      .then((result) => {
        if (cancelled) return;
        // 加油包不走套餐下单:目录与订单在配额管理页,直接送过去(此前只弹一条横幅
        // 然后照套餐下单)。
        if (result.intent === "addon") {
          router.replace("/quotas");
          return;
        }
        // Degrade (arda_303 §2.2 #1): unknown intent/product → home, with a reason.
        if (result.intent === null || result.product === null) {
          router.replace("/subscription?notice=unknown-link");
          return;
        }
        setCtx(result);
        setAutoRenew(result.current?.autoRenew ?? false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, router, reloadKey]);

  const reload = useCallback(async () => {
    try {
      const fresh = await fetchSubscribeContext(query);
      setCtx(fresh);
      // 换了工作区就换了 current，预填随之重算。
      setAutoRenew(fresh.current?.autoRenew ?? false);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : tLoad("title"));
    }
  }, [query, tLoad]);

  // 待支付面板的倒计时:到点重取,让超时关闭显影。
  const pendingCountdown = useCountdown(
    ctx?.pendingOrder?.expireAt ?? null,
    () => void reload(),
  );

  if (loadFailed) {
    return (
      <ViewLayout className="mx-auto w-full max-w-content-base-xl">
        <ViewHeader icon="credit-card" title={t("confirm.title")} />
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      </ViewLayout>
    );
  }

  if (loading || !ctx) {
    return (
      <ViewLayout className="mx-auto w-full max-w-content-base-xl">
        <EmptyState title={t("loading")} />
      </ViewLayout>
    );
  }

  const {
    intent,
    product,
    targetTier,
    current,
    pendingOrder,
    plans,
    versionChange,
    currentPlanRetired,
  } = ctx;
  if (intent === null || product === null) return null;

  // ── 待支付订单：直接引导进付款页（product_321 §6.1）─────────────────────────
  if (pendingOrder) {
    return (
      <ViewLayout className="mx-auto w-full max-w-content-base-xl">
        <ViewHeader
          icon="credit-card"
          title={t("pending.title")}
          description={t("pending.awaiting")}
          action={
            pendingCountdown ? (
              <StatusBadge tone="warning">
                {t("pending.countdown", { time: pendingCountdown })}
              </StatusBadge>
            ) : undefined
          }
        />
        {pendingCountdown === "00:00" ? (
          <Banner tone="warning" title={t("pending.expired")} />
        ) : null}
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
    /*
     * 暂停分两句（2026-09-25 步骤三）：顺延只在这一次暂停「不是客户自己违规」时成立，
     * 无条件写成「恢复后顺延」就是对违规暂停的假承诺。标志为 null（不在暂停 / 存量冻结行
     * 没有 episode）时走中性那句——什么都不多说，而不是猜一个。
     *
     * 不把暂停原因传到客户界面：那里有「客户违规」这一档，是运营的判断。
     */
    if (current.status === "suspended" && current.suspensionExtendsTerm) {
      return "suspendedExtended";
    }
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

  /*
   * 深链指到一个**不高于当前档**的档位（owner 2026-09-24：「降档完全不允许」）。
   *
   * 这是本页最要紧的一道，因为带 `target_tier` 的深链**直接落确认页**、不给二次选择：
   * 官网 /pricing 的档位 CTA 就是这么进来的，未登录时还会插一段登录，客户回来时看到的
   * 已经是一张填好的确认单。当时当前档是 Starter、深链带 free，下面那行 orderIntent
   * 把「在用 + 别的档」一律算成 upgrade（不看方向），服务端 upgrade 分支当时也不判方向
   * ——于是一张 0 元单就地把付费订阅改写成 Free、周期重置（ORD-202609-63E0E32517）。
   *
   * 处置与 `tierMissing` 同一条路：**不预选、退回档位阶梯让人重新挑**，而不是静默换一档。
   */
  const tierDowngrade =
    tierMatched !== null &&
    current !== null &&
    currentLiveVersionId !== null &&
    tierMatched.planCode !== current.planCode &&
    !isTierUpgrade(current.tier, tierMatched.tier);

  // 兜底预选不选当前套餐：同套餐"升级"是付费空操作（服务端同样拒绝）。
  // 阶梯按 TIERS 升序，优先当前档之上的第一档；已是顶档则不预选。
  const fallbackPlan = (() => {
    if (!currentLiveVersionId || !current) return plans[0] ?? null;
    /* 按**套餐码**找当前档的位置，不按版本：套餐发布新版本后阶梯里是新版本 id，
       按版本找会找不到（idx = -1）→ 预选落到 plans[0]，把人送去最低档。 */
    const idx = plans.findIndex((p) => p.planCode === current.planCode);
    return plans[idx + 1] ?? null;
  })();

  const plan: SubscribePlanOption | null =
    (pickedVersionId
      ? (plans.find((p) => p.planVersionId === pickedVersionId) ?? null)
      : null) ??
    (tierDowngrade ? null : tierMatched) ??
    (tierMissing || tierDowngrade ? null : fallbackPlan);

  const showTierFallback =
    (!targetTier || tierMissing || tierDowngrade) && plans.length > 1;
  /*
   * 选中的就是在用套餐 → 走「续订」（延长周期）。
   *
   * 判据是**套餐码**，不是版本（owner 2026-09-22）。套餐一旦发布新版本，阶梯送的就是
   * 新版本 id，按版本判会把同一档的老客户判成「升级」——周期从现在重置、走折抵报价、
   * 订阅被重钉，界面还写「升级」，全程不报错。续订问的是「还是不是这个套餐」。
   */
  const isCurrentPlan =
    plan !== null &&
    current !== null &&
    currentLiveVersionId !== null &&
    plan.planCode === current.planCode;

  /*
   * 最终选中的那一档是不是降档。上面 `tierDowngrade` 只管深链带来的那一档；这一条管
   * **用户自己从阶梯里挑**的，两者都要挡——服务端是主闸门（409 NOT_AN_UPGRADE），
   * 这里挡的是「让人点下去再被拒」这件事本身。
   */
  const selectedIsDowngrade =
    plan !== null &&
    current !== null &&
    currentLiveVersionId !== null &&
    plan.planCode !== current.planCode &&
    !isTierUpgrade(current.tier, plan.tier);

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
    /* 降档不下单（owner 2026-09-24）。按钮已禁用，这一行是它被绕过时的那道。 */
    if (selectedIsDowngrade) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createSubscriptionOrder({
        productCode: product.code,
        planVersionId: plan.planVersionId,
        cycleUnit: cycle,
        intent: orderIntent,
        autoRenew,
        ...(orderIntent !== "new" && current
          ? { upgradeOfSubscriptionId: current.subscriptionId }
          : {}),
        /* 跨版本续订：把差异面板上呈现的那个来源版本回送，作为「客户已知情」的凭据。
           服务端比对它与原订阅当前钉着的版本——期间若又发版，旧确认失效要重看。 */
        ...(orderIntent === "renew" && versionChange
          ? { acceptVersionChangeFrom: versionChange.fromPlanVersionId }
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
      setError(e instanceof Error && e.message ? e.message : t("orderFailed"));
      setBusy(false);
    }
  };

  const contactSales = () => {
    window.location.href = `mailto:sales@vxture.com?subject=${encodeURIComponent(
      t("contactSalesSubject", { product: product.name }),
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
            {/*
             * 降档的两种到法各有各的话要说：
             *   · 深链指到不高于当前档的那一档 → 这里不出确认卡，改出提示 + 下方阶梯，
             *     人在**同一页**重新挑一个更高的档（owner 2026-09-24：「返回到订阅选择
             *     页面，让用户重新选择升级」）；
             *   · 人自己从阶梯里挑了降档 → 确认卡照出（他要看清自己挑了什么），但按提示
             *     + 禁用提交拦住。
             */}
            {tierDowngrade && current ? (
              <Banner
                tone="warning"
                title={t("confirm.downgradeBlocked", {
                  current: current.tier ?? current.planCode,
                })}
                description={t("confirm.downgradeHint")}
              />
            ) : null}
            {plan ? (
              <>
                <PlanSummaryCard
                  productName={product.name}
                  plan={plan}
                  note={planNote}
                />
                {selectedIsDowngrade && current ? (
                  <Banner
                    className="mt-sm"
                    tone="warning"
                    title={t("confirm.downgradeBlocked", {
                      current: current.tier ?? current.planCode,
                    })}
                    description={t("confirm.downgradeHint")}
                  />
                ) : null}
              </>
            ) : plans.length > 0 && !tierDowngrade ? (
              <Banner tone="warning" title={t("confirm.tierUnavailable")} />
            ) : plans.length === 0 ? (
              <EmptyState title={t("noPlans")} />
            ) : null}
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
              // 续订接在当前订阅到期之后;新订 / 升级从此刻起算(升级立即生效)。
              startAt={
                orderIntent === "renew" && isLive
                  ? (current?.endAt ?? null)
                  : null
              }
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
              {orderIntent === "renew" && isLive
                ? t("confirm.startNoteRenew")
                : t("confirm.startNote")}
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
            {/*
             * 在用套餐已下架（owner 2026-09-22：退役 = 服务到本周期为止，不再续）。
             * 此前这种情况会静默把人推进一个写着「升级」的同档位假动作——他既看不到
             * 自己那一档（阶梯里没有退役套餐），也不知道为什么。
             */}
            {currentPlanRetired ? (
              <Banner
                tone="warning"
                title={t("retired.title")}
                description={t("retired.description")}
              />
            ) : null}

            {/*
             * 续订会换版本：把差异摆出来，客户要有知情权与决策权（owner 2026-09-22）。
             * 差异由服务端算——两边各算一份迟早分叉成「界面说没变、下单却变了」。
             * 三项全空时不画表（只翻了版本号、内容没变），但下单仍会回送确认。
             */}
            {versionChange &&
            orderIntent === "renew" &&
            (versionChange.prices.length > 0 ||
              versionChange.quota.length > 0 ||
              versionChange.featuresAdded.length > 0 ||
              versionChange.featuresRemoved.length > 0) ? (
              <div className="flex flex-col gap-sm">
                <Banner
                  tone="info"
                  title={t("versionChange.title")}
                  description={t("versionChange.hint")}
                />
                <div className="flex flex-col gap-2xs text-body-sm">
                  {versionChange.prices.map((row) => (
                    <span key={`p-${row.cycleUnit}`}>
                      {t("versionChange.price", {
                        cycle: t(`cycle.${row.cycleUnit}`),
                      })}
                      ：{row.from ?? "—"} → <b>{row.to ?? "—"}</b>
                    </span>
                  ))}
                  {versionChange.quota.map((row) => (
                    <span key={`q-${row.key}`}>
                      {row.key}：{row.from ?? "—"} → <b>{row.to ?? "—"}</b>
                    </span>
                  ))}
                  {versionChange.featuresAdded.length > 0 ? (
                    <span>
                      {t("versionChange.featuresAdded")}：
                      {versionChange.featuresAdded.join("、")}
                    </span>
                  ) : null}
                  {versionChange.featuresRemoved.length > 0 ? (
                    <span>
                      {t("versionChange.featuresRemoved")}：
                      {versionChange.featuresRemoved.join("、")}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

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
                {orderIntent === "upgrade" && current && price ? (
                  // 折抵报价在子组件里取（hook 不能放在本组件的早退之后）
                  <UpgradeQuoteSummary
                    subscriptionId={current.subscriptionId}
                    planVersionId={plan.planVersionId}
                    cycle={cycle}
                    fallbackTotal={formatMoney(price.price, price.currency)}
                  />
                ) : (
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
                )}
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
                    {/* 自动续费 opt-in：合计之下、提交之上；说明只进 tooltip 不铺在页面上
                        （owner 2026-09-03）。企业档不走这里。 */}
                    <div className="flex items-center justify-between gap-md text-body-md">
                      <span className="flex items-center gap-2xs text-muted-foreground">
                        {t("confirm.autoRenew")}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={t("confirm.autoRenewTip")}
                            >
                              <Icon
                                name="info"
                                size="xs"
                                fallback="placeholder"
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("confirm.autoRenewTip")}
                          </TooltipContent>
                        </Tooltip>
                      </span>
                      <Switch
                        checked={autoRenew}
                        onCheckedChange={setAutoRenew}
                        aria-label={t("confirm.autoRenew")}
                      />
                    </div>
                    <Button
                      size="xl"
                      disabled={busy || !price || selectedIsDowngrade}
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
