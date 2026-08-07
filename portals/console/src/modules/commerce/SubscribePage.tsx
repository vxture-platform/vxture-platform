"use client";

/**
 * SubscribePage — the product→console conversion deep-link landing +
 * ordering surface (product_200 §3.2; product_320 §4.4).
 *
 * Entry: /subscribe?product=..&intent=subscribe|upgrade|renew|addon[&target_tier][&metric]
 * Fault-tolerance (arda_303 §2.2): unknown intent/product → degrade to the
 * subscription home. State machine (product_320):
 *  - a pending offline order exists → awaiting-confirmation panel (order no +
 *    transfer instructions + cancel);
 *  - otherwise the plan ladder with a month/year toggle: free → activate now,
 *    paid → subscribe/renew (new) or upgrade (from a live sub), enterprise
 *    (no price rows) → contact sales.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DetailList,
  DetailRow,
  EmptyState,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
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

const STATUS_KEYS = new Set([
  "active",
  "trialing",
  "overdue",
  "suspended",
  "expired",
  "cancelled",
]);

type Cycle = "month" | "year";
const CYCLES: Cycle[] = ["month", "year"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function formatMoney(amount: string, currency: string): string {
  const n = Number.parseFloat(amount);
  const value = Number.isFinite(n) ? n.toLocaleString() : amount;
  const prefix = currency === "CNY" ? "¥" : `${currency} `;
  return `${prefix}${value}`;
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
  const [busy, setBusy] = useState<string | null>(null); // planVersionId | "cancel"
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

  if (loading || !ctx) {
    return (
      <ViewLayout>
        <EmptyState title={t("loading")} />
      </ViewLayout>
    );
  }

  const { intent, product, targetTier, metric, current, pendingOrder, plans } =
    ctx;
  if (intent === null || product === null) return null;

  async function reload() {
    const fresh = await fetchSubscribeContext(query);
    if (fresh) setCtx(fresh);
  }

  // ── 待支付订单：直接引导进付款页（product_321 §6.1，占位面板退役）──────────
  if (pendingOrder) {
    return (
      <ViewLayout>
        <ViewHeader
          icon="chart-bar"
          title={t("pending.title")}
          description={t("pending.awaiting")}
        />
        <PageSection icon="clock" level={2} title={t("pending.title")}>
          <div className="flex flex-col gap-md">
            <DetailList>
              <DetailRow label={t("pending.orderNo")}>
                {pendingOrder.orderNo}
              </DetailRow>
              <DetailRow label={t("plansSection")}>
                {pendingOrder.planCode}
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

  const onSelect = async (plan: SubscribePlanOption) => {
    setBusy(plan.planVersionId);
    setError(null);
    const orderIntent: "new" | "renew" | "upgrade" = !current
      ? "new"
      : isLive
        ? "upgrade"
        : "renew";
    try {
      const result = await createSubscriptionOrder({
        productCode: product.code,
        planVersionId: plan.planVersionId,
        cycleUnit: cycle,
        intent: orderIntent,
        ...(orderIntent === "upgrade" && current
          ? { upgradeOfSubscriptionId: current.subscriptionId }
          : {}),
      });
      if (result.status === "active") {
        router.replace("/subscription"); // free 即时开通
        return;
      }
      if (result.orderId) {
        // 付费订单 → 直达付款页（product_321 §6.1，不再就地渲染面板）
        router.push(`/subscribe/pay/${result.orderId}`);
        return;
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("orderFailed"));
      setBusy(null);
    }
  };

  const contactSales = () => {
    window.location.href = `mailto:sales@vxture.com?subject=${encodeURIComponent(
      `${product.name} 企业版咨询`,
    )}`;
  };

  const planButtonLabel = (isFree: boolean) =>
    isFree
      ? t("actions.activateFree")
      : !current
        ? t("actions.subscribe")
        : isLive
          ? t("actions.upgrade")
          : t("actions.renew");

  return (
    <ViewLayout>
      <ViewHeader
        icon="chart-bar"
        title={t(`title.${intent}`)}
        description={t(`hint.${stateKey}`)}
      />

      <PageSection
        icon="package"
        level={2}
        title={t("currentSection")}
        action={
          current ? (
            <StatusBadge tone={isLive ? "success" : "neutral"}>
              {STATUS_KEYS.has(current.status)
                ? t(`status.${current.status}`)
                : current.status}
            </StatusBadge>
          ) : undefined
        }
      >
        {current ? (
          <div className="flex flex-col gap-md">
            <strong className="text-title-sm text-foreground">
              {current.planCode}
            </strong>
            <DetailList>
              <DetailRow label={t("fields.tier")}>
                {current.tier ?? "—"}
              </DetailRow>
              <DetailRow
                label={
                  current.status === "trialing"
                    ? t("fields.trialEndsAt")
                    : t("fields.periodEnd")
                }
              >
                {formatDate(
                  current.status === "trialing"
                    ? current.trialEndAt
                    : current.endAt,
                )}
              </DetailRow>
              <DetailRow label={t("fields.autoRenew")}>
                {current.autoRenew
                  ? t("fields.autoRenewOn")
                  : t("fields.autoRenewOff")}
              </DetailRow>
            </DetailList>
          </div>
        ) : (
          <EmptyState title={t("noSubscription")} />
        )}
      </PageSection>

      {intent === "addon" ? (
        <PageSection icon="puzzle" level={2} title={t("addonSection")}>
          <EmptyState
            title={
              metric ? t("addonNoticeMetric", { metric }) : t("addonNotice")
            }
          />
        </PageSection>
      ) : null}

      <PageSection icon="chart-bar" level={2} title={t("plansSection")}>
        <div className="flex flex-col gap-md">
          <SegmentedControl
            value={cycle}
            onChange={(next) => setCycle(next)}
            items={CYCLES.map((c) => ({
              value: c,
              label: t(`cycleToggle.${c === "month" ? "monthly" : "yearly"}`),
            }))}
          />

          {plans.length === 0 ? (
            <EmptyState title={t("noPlans")} />
          ) : (
            <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => {
                const isCurrent =
                  current !== null &&
                  plan.planVersionId === current.planVersionId;
                const isTarget =
                  targetTier !== null && plan.tier === targetTier;
                const isEnterprise = plan.prices.length === 0;
                const price = priceForCycle(plan, cycle);
                const isFree = price
                  ? Number.parseFloat(price.price) <= 0
                  : false;
                const action = isCurrent ? null : isEnterprise ? (
                  <Button variant="outline" onClick={contactSales}>
                    {t("actions.contactSales")}
                  </Button>
                ) : price ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => void onSelect(plan)}
                  >
                    {busy === plan.planVersionId
                      ? t("actions.processing")
                      : planButtonLabel(isFree)}
                  </Button>
                ) : null;
                return (
                  <Card key={plan.planId} surface="soft">
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-xs">
                        <CardTitle>{plan.planName}</CardTitle>
                        <StatusBadge>{plan.tier}</StatusBadge>
                        {isCurrent ? (
                          <StatusBadge tone="info">
                            {t("badges.current")}
                          </StatusBadge>
                        ) : null}
                        {isTarget && !isCurrent ? (
                          <StatusBadge tone="success">
                            {t("badges.recommended")}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <CardDescription>
                        {isEnterprise
                          ? t("actions.contactSales")
                          : price
                            ? `${formatMoney(price.price, price.currency)} / ${t(
                                `cycle.${price.cycleUnit}`,
                              )}`
                            : t("pricePending")}
                      </CardDescription>
                    </CardHeader>
                    {action ? <CardFooter>{action}</CardFooter> : null}
                  </Card>
                );
              })}
            </div>
          )}
          {error ? <Banner tone="danger" title={error} /> : null}
        </div>
      </PageSection>

      <PageSection icon="dots-three" level={2} title={t("moreSection")}>
        <Button variant="outline" onClick={() => router.push("/subscription")}>
          {t("actions.backToSubscription")}
        </Button>
      </PageSection>
    </ViewLayout>
  );
}
