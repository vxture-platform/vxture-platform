"use client";

/**
 * OrderPayPage.tsx - 订单付款页（product_321 §6.1；订阅链路 v5 稿）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 同一路由按六态切换渲染，页内统一挂四步流程条（下单→付款→收款→开通）：
 * 待付款 = 左「选择付款方式」+ 右「订单信息」（金额 + 券勾选 + 申报）双栏；
 * 已付款·待确认 / 开通处理中 = 轮询面板；完成 = 成功视图 + 后续入口；
 * 取消/超时 = 终态视图。勾选变化调 quote 纯试算；「我已完成付款」弹 DS
 * Dialog 确认后 declare。倒计时如实显示服务端 expireAt（TTL 归后端）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import { useRouter } from "@/lib/i18n/navigation";
import {
  Banner,
  Button,
  Checkbox,
  DetailList,
  DetailRow,
  DialogForm,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  Skeleton,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import {
  ConsoleBffError,
  declareOrderPayment,
  fetchOrderDetail,
  quoteOrder,
  cancelSubscriptionOrder,
  fetchRefundEligibility,
  requestOrderRefund,
  type RefundEligibility,
  type OrderDetail,
  type OrderQuote,
  type OrderState,
  type OrderVoucherOption,
  type PaymentChannelInfo,
} from "@/api/console-bff";
import { OrderFlowStrip } from "./components/OrderFlowStrip";
import { SECTION_TIGHT, SectionTitle } from "./components/sectionKit";
import { buildWebsiteRefundPolicyUrl } from "@/lib/website-entry";

const POLL_MS = 15_000;

/**
 * Severity of each order state. The mapping is a product judgement, so it
 * lives here rather than in the design system (tone only means severity).
 */
const STATE_TONE: Record<OrderState, StatusBadgeTone> = {
  pending_payment: "warning",
  paid_pending_verify: "warning",
  activating: "info",
  completed: "success",
  cancelled: "danger",
  expired: "danger",
};

type PayChannel = "alipay" | "bank_transfer";

/** 货币展示统一走 shared formatCurrency（110-locale-layer 指定入口）。 */
function fmtWith(locale: Locale) {
  return (amount: string, currency: string): string => {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    return formatCurrency(n, locale, currency);
  };
}

/** 倒计时：<1h 显示 mm:ss，否则 hh:mm:ss（团队租户 48h 窗口不至于溢出）。 */
function useCountdown(deadline: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  const remain = new Date(deadline).getTime() - now;
  if (remain <= 0) return "00:00";
  const h = Math.floor(remain / 3_600_000);
  const m = Math.floor((remain % 3_600_000) / 60_000);
  const s = Math.floor((remain % 60_000) / 1_000);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

function voucherLabel(
  v: OrderVoucherOption,
  t: ReturnType<typeof useTranslations>,
  fmt: (amount: string, currency: string) => string,
): string {
  if (v.kind === "discount") {
    const off =
      v.discountType === "percent"
        ? t("voucher.percentOff", { value: v.discountValue ?? 0 })
        : // fixed effect value is integer cents (230 §4) — display in yuan
          t("voucher.fixedOff", {
            value: ((v.discountValue ?? 0) / 100).toFixed(2),
          });
    return `${v.batchName} · ${off}`;
  }
  return `${v.batchName} · ${fmt(String(v.amount ?? 0), "CNY")}`;
}

export function OrderPayPage() {
  const t = useTranslations("orderPay");
  const fmt = fmtWith(useLocale() as Locale);
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId ?? "";
  const { session } = useConsoleSession();
  // 申报付款 = tenant.payment.manage;取消订单 / 申请退款 = tenant.billing.manage
  // (与 BFF 守卫同码)。无码的人能看订单,但落锤按钮不可用并说明原因。
  const canPay = hasCapability(session.capabilities, "tenant.payment.manage");
  const canManageBilling = hasCapability(
    session.capabilities,
    "tenant.billing.manage",
  );

  const [detail, setDetail] = useState<OrderDetail | null>(null);
  // 24h 退款（product_330 §5）：完成态才取资格；申请后以 detail.refund 展示进度
  const [refundEligibility, setRefundEligibility] =
    useState<RefundEligibility | null>(null);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [refundFeedback, setRefundFeedback] = useState<string | null>(null);
  const locale = useLocale();

  useEffect(() => {
    let alive = true;
    if (!detail || detail.orderState !== "completed" || detail.refund) {
      setRefundEligibility(null);
      return () => {
        alive = false;
      };
    }
    void fetchRefundEligibility(detail.orderId).then((e) => {
      if (alive) setRefundEligibility(e);
    });
    return () => {
      alive = false;
    };
  }, [detail]);
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [discountId, setDiscountId] = useState<string | null>(null);
  const [creditId, setCreditId] = useState<string | null>(null);
  const [channel, setChannel] = useState<PayChannel>("alipay");
  const [declareOpen, setDeclareOpen] = useState(false);
  const [payerName, setPayerName] = useState("");
  const [transactionNo, setTransactionNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const defaultsApplied = useRef(false);

  const reload = useCallback(async () => {
    if (inFlight.current || !orderId) return;
    inFlight.current = true;
    try {
      const next = await fetchOrderDetail(orderId);
      setDetail(next);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Default channel = first enabled; default discount voucher = best (P5:
  // 默认勾选最优折扣券 — the list is server-sorted; pick the first discount).
  useEffect(() => {
    if (!detail || defaultsApplied.current) return;
    defaultsApplied.current = true;
    const firstEnabled = detail.paymentChannels.find(
      (c): c is PaymentChannelInfo & { channel: PayChannel } =>
        c.enabled && (c.channel === "alipay" || c.channel === "bank_transfer"),
    );
    if (firstEnabled) setChannel(firstEnabled.channel);
    const bestDiscount = detail.vouchers.find((v) => v.kind === "discount");
    if (bestDiscount) setDiscountId(bestDiscount.voucherId);
  }, [detail]);

  // Quote re-run on any voucher selection change (pending state only).
  useEffect(() => {
    if (!detail || detail.orderState !== "pending_payment") return;
    let cancelled = false;
    quoteOrder(detail.orderId, {
      ...(discountId ? { discountVoucherId: discountId } : {}),
      ...(creditId ? { creditVoucherId: creditId } : {}),
    })
      .then((q) => {
        if (!cancelled) {
          setQuote(q);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("errors.quote"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail, discountId, creditId, t]);

  // Poll while awaiting confirmation / activation (ConsoleSessionProvider
  // pattern: interval + focus/visibility triggers + in-flight dedupe).
  const polling =
    detail?.orderState === "paid_pending_verify" ||
    detail?.orderState === "activating";
  useEffect(() => {
    if (!polling) return;
    const tick = () => void reload();
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [polling, reload]);

  const countdown = useCountdown(
    detail?.orderState === "pending_payment" ? detail.expireAt : null,
  );

  const discountVouchers = useMemo(
    () => detail?.vouchers.filter((v) => v.kind === "discount") ?? [],
    [detail],
  );
  const creditVouchers = useMemo(
    () => detail?.vouchers.filter((v) => v.kind === "credit_voucher") ?? [],
    [detail],
  );
  const activeChannel = detail?.paymentChannels.find(
    (c) => c.channel === channel,
  );
  const cashDue = quote?.cashDue ?? detail?.listPrice ?? "0";
  // Hoisted so the checkbox rows can narrow the optional element once.
  const bestDiscount = discountVouchers[0];
  const bestCredit = creditVouchers[0];

  // 归属（给谁买）来自会话——订单本就是当前租户维度的资源。
  // 展示 = 租户名 · 工作区名（UUID 禁展示；workspace 字段是内部 id，不用）。
  const ownerLabel = session.tenant
    ? [session.tenant.name, session.tenant.workspaceName]
        .filter(Boolean)
        .join(" · ")
    : null;

  // 流程条时间戳：下单 = createdAt；付款 = 最近一笔现金腿的申报时刻。
  const declaredAt = useMemo(() => {
    const cashLegs = detail?.legs.filter((l) => l.kind === "cash") ?? [];
    return cashLegs.length > 0
      ? (cashLegs[cashLegs.length - 1]?.createdAt ?? null)
      : null;
  }, [detail]);

  async function handleDeclare() {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await declareOrderPayment(detail.orderId, {
        payChannel: channel,
        ...(discountId ? { discountVoucherId: discountId } : {}),
        ...(creditId ? { creditVoucherId: creditId } : {}),
        ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
        ...(transactionNo.trim()
          ? { transactionNo: transactionNo.trim() }
          : {}),
      });
      setDeclareOpen(false);
      if (result.outcome === "activated") {
        router.replace("/subscription");
        return;
      }
      await reload();
    } catch (err) {
      setError(
        err instanceof ConsoleBffError ? err.message : t("errors.declare"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelSubscriptionOrder(detail.orderId);
      router.replace("/subscription");
    } catch (err) {
      setError(
        err instanceof ConsoleBffError ? err.message : t("errors.cancel"),
      );
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <ViewLayout className="mx-auto w-full max-w-content-base-xl">
        <ViewHeader icon="credit-card" title={t("title")} description="" />
        <Skeleton />
      </ViewLayout>
    );
  }
  if (!detail) {
    return (
      <ViewLayout className="mx-auto w-full max-w-content-base-xl">
        <ViewHeader
          icon="credit-card"
          title={t("title")}
          description={t("notFound")}
          action={
            <Button
              variant="outline"
              onClick={() => router.push("/subscription")}
            >
              {t("actions.backToSubscription")}
            </Button>
          }
        />
      </ViewLayout>
    );
  }

  const state = detail.orderState;

  const submitRefundRequest = async () => {
    if (!detail) return;
    setSubmittingRefund(true);
    setRefundFeedback(null);
    try {
      const refund = await requestOrderRefund(detail.orderId, refundReason);
      setDetail({ ...detail, refund });
      setRefundDialogOpen(false);
      setRefundReason("");
      setRefundFeedback(t("refund.submitted"));
    } catch (error) {
      setRefundFeedback(
        error instanceof Error && error.message
          ? error.message
          : t("refund.requestFailed"),
      );
    } finally {
      setSubmittingRefund(false);
    }
  };
  const isPending = state === "pending_payment";
  const fullVoucherCover = isPending && Number(cashDue) === 0;
  // 「产品主名 · 套餐名」——付款页是客户最后一次确认「我在为什么付钱」的地方，
  // 只写套餐名（入门版）看不出是哪个产品的入门版；编码只作最后兜底。
  const planLabel = `${[detail.productName, detail.planName || detail.planCode]
    .filter(Boolean)
    .join(" · ")}${detail.tier ? ` · ${detail.tier}` : ""}`;

  const stateBadge = (
    <StatusBadge tone={STATE_TONE[state]}>{t(`status.${state}`)}</StatusBadge>
  );

  return (
    <ViewLayout className="mx-auto w-full max-w-content-base-xl">
      <ViewHeader
        icon="credit-card"
        title={t("title")}
        secondary={
          <span className="font-mono text-body-md text-muted-foreground">
            {detail.orderNo}
          </span>
        }
        action={
          countdown ? (
            <StatusBadge tone="warning">
              {t("countdown", { time: countdown })}
            </StatusBadge>
          ) : undefined
        }
      />
      {detail.rejectReason && isPending ? (
        <Banner
          tone="danger"
          title={t("rejectBanner", { reason: detail.rejectReason })}
        />
      ) : null}

      <OrderFlowStrip
        stage={state}
        times={{
          order: detail.createdAt,
          ...(declaredAt ? { pay: declaredAt } : {}),
        }}
        badge={stateBadge}
      />

      {isPending ? (
        <div className="flex flex-col gap-md lg:flex-row lg:items-stretch">
          {/* 左栏：选择付款方式 */}
          <PageSection
            tone="raised"
            level={2}
            title={
              <SectionTitle icon="credit-card">
                {t("channels.title")}
              </SectionTitle>
            }
            className={`min-w-0 flex-1 ${SECTION_TIGHT}`}
          >
            <SegmentedControl<string>
              ariaLabel={t("channels.title")}
              value={channel}
              onChange={(value) => {
                if (value === "alipay" || value === "bank_transfer")
                  setChannel(value);
              }}
              items={detail.paymentChannels.map((c) => ({
                value: c.channel,
                label: `${t(`channels.${c.channel}`)}${
                  !c.enabled ? ` · ${t("channels.comingSoon")}` : ""
                }`,
                disabled: !c.enabled,
              }))}
            />

            {channel === "alipay" && activeChannel?.qrAsset ? (
              <div className="flex flex-wrap items-start gap-md">
                <div className="flex shrink-0 justify-center rounded-lg bg-accent p-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeChannel.qrAsset}
                    alt={t("channels.alipayQrAlt")}
                    className="h-auto w-media-2xl max-w-full"
                  />
                </div>
                <p className="min-w-0 flex-1 text-body-md text-muted-foreground">
                  {t("referenceNote", { orderNo: detail.orderNo })}
                </p>
              </div>
            ) : null}

            {channel === "bank_transfer" && activeChannel?.account ? (
              <>
                <DetailList>
                  <DetailRow label={t("bank.accountName")}>
                    {activeChannel.account.accountName}
                  </DetailRow>
                  <DetailRow label={t("bank.bankName")}>
                    {activeChannel.account.bankName}
                  </DetailRow>
                  <DetailRow label={t("bank.accountNo")}>
                    <span className="tabular-nums">
                      {activeChannel.account.accountNo}
                    </span>
                  </DetailRow>
                </DetailList>
                <p className="text-body-sm text-muted-foreground">
                  {t("referenceNote", { orderNo: detail.orderNo })}
                </p>
              </>
            ) : null}

            {detail.paymentChannels.every((c) => !c.enabled) ? (
              <p className="text-body-sm text-muted-foreground">
                {t("channels.noneEnabled")}
              </p>
            ) : null}

            <div className="mt-auto">
              <Banner tone="info" title={t("manualNote")} />
            </div>
          </PageSection>

          {/* 右栏：订单信息（金额 + 券 + 申报） */}
          <aside className="w-full lg:max-w-panel-sm lg:shrink-0">
            <PageSection
              tone="raised"
              level={2}
              title={
                <SectionTitle icon="receipt">{t("info.title")}</SectionTitle>
              }
              className={`h-full ${SECTION_TIGHT}`}
            >
              <div className="flex flex-col items-center gap-2xs py-xs">
                <span className="text-body-sm text-muted-foreground">
                  {t("amountDue")}
                </span>
                <strong className="text-heading-2 text-foreground tabular-nums">
                  {fmt(cashDue, detail.currency)}
                </strong>
              </div>

              <DetailList>
                {ownerLabel ? (
                  <DetailRow label={t("info.owner")}>{ownerLabel}</DetailRow>
                ) : null}
                <DetailRow label={t("info.plan")}>
                  {planLabel} · {t(`cycle.${detail.cycleUnit}` as never)}
                </DetailRow>
                <DetailRow label={t("breakdown.listPrice")}>
                  <span className="tabular-nums">
                    {fmt(quote?.listPrice ?? detail.listPrice, detail.currency)}
                  </span>
                </DetailRow>

                <DetailRow
                  label={t("breakdown.discountVoucher")}
                  actions={
                    <span className="text-body-md text-success-text tabular-nums">
                      {quote && Number(quote.discountOff) > 0
                        ? `− ${fmt(quote.discountOff, detail.currency)}`
                        : "—"}
                    </span>
                  }
                >
                  {bestDiscount ? (
                    <Field orientation="horizontal" className="w-auto">
                      <Checkbox
                        id="order-pay-discount"
                        checked={Boolean(discountId)}
                        onCheckedChange={(checked) =>
                          setDiscountId(
                            checked === true
                              ? (discountVouchers[0]?.voucherId ?? null)
                              : null,
                          )
                        }
                      />
                      <FieldLabel htmlFor="order-pay-discount">
                        {voucherLabel(bestDiscount, t, fmt)}
                      </FieldLabel>
                    </Field>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("breakdown.noDiscountVoucher")}
                    </span>
                  )}
                </DetailRow>

                <DetailRow
                  label={t("breakdown.creditVoucher")}
                  actions={
                    <span className="text-body-md text-success-text tabular-nums">
                      {quote && Number(quote.voucherOff) > 0
                        ? `− ${fmt(quote.voucherOff, detail.currency)}`
                        : "—"}
                    </span>
                  }
                >
                  {bestCredit ? (
                    <Field orientation="horizontal" className="w-auto">
                      <Checkbox
                        id="order-pay-credit"
                        checked={Boolean(creditId)}
                        onCheckedChange={(checked) =>
                          setCreditId(
                            checked === true
                              ? (creditVouchers[0]?.voucherId ?? null)
                              : null,
                          )
                        }
                      />
                      <FieldLabel htmlFor="order-pay-credit">
                        {voucherLabel(bestCredit, t, fmt)}
                      </FieldLabel>
                    </Field>
                  ) : (
                    <span className="text-muted-foreground">
                      {t("breakdown.noCreditVoucher")}
                    </span>
                  )}
                </DetailRow>

                {Number(detail.paidAmount) > 0 ? (
                  <DetailRow label={t("breakdown.alreadyPaid")}>
                    <span className="text-success-text tabular-nums">
                      − {fmt(detail.paidAmount, detail.currency)}
                    </span>
                  </DetailRow>
                ) : null}
              </DetailList>

              {error ? <Banner tone="danger" title={error} /> : null}

              <div className="mt-auto flex flex-col gap-sm">
                <Button
                  size="xl"
                  onClick={() => {
                    setError(null);
                    setDeclareOpen(true);
                  }}
                  disabled={submitting || !quote || !canPay}
                  className="w-full border-transparent bg-linear-to-r from-gradient-brand-from to-gradient-brand-to text-primary-foreground hover:brightness-110"
                >
                  {fullVoucherCover
                    ? t("actions.settleInstant")
                    : t("actions.declarePaid")}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => void handleCancel()}
                  disabled={
                    submitting ||
                    Number(detail.paidAmount) > 0 ||
                    !canManageBilling
                  }
                >
                  {t("actions.cancelOrder")}
                </Button>
                <p className="text-center text-body-sm text-content-tertiary">
                  {t("ttlFine")}
                </p>
                {!canPay || !canManageBilling ? (
                  <p className="text-center text-body-sm text-warning-text">
                    {t("actions.noPaymentPermission")}
                  </p>
                ) : null}
              </div>
            </PageSection>
          </aside>
        </div>
      ) : state === "completed" ? (
        <div className="flex flex-col gap-md lg:flex-row lg:items-stretch">
          <PageSection
            tone="raised"
            className={`min-w-0 flex-1 ${SECTION_TIGHT}`}
          >
            <div className="flex flex-col items-center gap-sm py-sm text-center">
              <span
                aria-hidden="true"
                className="flex size-control-2xl items-center justify-center rounded-full border-2 border-success-border bg-success-muted text-success-text"
              >
                <Icon name="check" size="lg" />
              </span>
              <strong className="text-title-lg text-foreground">
                {t("stateTitle.completed")}
              </strong>
              <p className="text-body-md text-muted-foreground">
                {t("stateHint.completed")}
              </p>
            </div>
            <DetailList>
              {ownerLabel ? (
                <DetailRow label={t("info.owner")}>{ownerLabel}</DetailRow>
              ) : null}
              <DetailRow label={t("info.orderNo")}>
                <span className="font-mono">{detail.orderNo}</span>
              </DetailRow>
              <DetailRow label={t("info.plan")}>
                {planLabel} · {t(`cycle.${detail.cycleUnit}` as never)}
              </DetailRow>
              <DetailRow label={t("breakdown.alreadyPaid")}>
                <span className="tabular-nums">
                  {fmt(detail.paidAmount, detail.currency)}
                </span>
              </DetailRow>
            </DetailList>
          </PageSection>
          <aside className="w-full lg:max-w-panel-sm lg:shrink-0">
            <PageSection
              tone="raised"
              level={2}
              title={
                <SectionTitle icon="arrow-long-right">
                  {t("completedPanel.next")}
                </SectionTitle>
              }
              className={`h-full ${SECTION_TIGHT}`}
            >
              <div className="mt-auto flex flex-col gap-sm">
                <Button
                  size="xl"
                  onClick={() => router.push("/subscription")}
                  className="w-full border-transparent bg-linear-to-r from-gradient-brand-from to-gradient-brand-to text-primary-foreground hover:brightness-110"
                >
                  {t("completedPanel.viewSubscription")}
                </Button>
                <Button
                  variant="outline"
                  size="xl"
                  className="w-full"
                  onClick={() => router.push("/billing")}
                >
                  {t("completedPanel.viewBilling")}
                </Button>
                <Button
                  variant="outline"
                  size="xl"
                  className="w-full"
                  onClick={() => router.push("/quotas")}
                >
                  {t("completedPanel.viewQuotas")}
                </Button>
              </div>
              {/* 24h 退款（product_330 §5）：已申请 → 进度；未申请 → 资格 + 申请入口；退款说明官网统一维护，newtab */}
              <div className="mt-md flex flex-col gap-xs border-t border-dashed border-primary/10 pt-md text-body-sm dark:border-primary/20">
                {detail.refund ? (
                  <>
                    <span className="font-medium text-foreground">
                      {t(`refund.status.${detail.refund.stage}`)} ·{" "}
                      {fmt(detail.refund.amount, detail.refund.currency)}
                    </span>
                    {detail.refund.auditRemark ? (
                      <span className="text-muted-foreground">
                        {t("refund.auditRemarkLine", {
                          remark: detail.refund.auditRemark,
                        })}
                      </span>
                    ) : null}
                  </>
                ) : refundEligibility?.eligible ? (
                  <>
                    <span className="text-muted-foreground">
                      {t("refund.requestHint", {
                        hours: refundEligibility.windowHours,
                        deadline: refundEligibility.windowEndsAt
                          ? new Date(
                              refundEligibility.windowEndsAt,
                            ).toLocaleString(locale)
                          : "—",
                      })}
                    </span>
                    {canManageBilling ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRefundFeedback(null);
                          setRefundDialogOpen(true);
                        }}
                      >
                        {t("refund.request")}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("refund.noPermission")}
                      </span>
                    )}
                  </>
                ) : refundEligibility ? (
                  <span className="text-muted-foreground">
                    {t("refund.ineligibleLine", {
                      reasons: refundEligibility.reasons
                        .map((r) => t(`refund.reasons.${r}` as never))
                        .join(t("refund.reasonSeparator")),
                    })}
                  </span>
                ) : null}
                {refundFeedback ? (
                  <span className="text-muted-foreground">
                    {refundFeedback}
                  </span>
                ) : null}
                <a
                  href={buildWebsiteRefundPolicyUrl(locale)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  {t("refund.policyLink")}
                </a>
              </div>
              {refundDialogOpen && refundEligibility ? (
                <DialogForm
                  open
                  title={t("refund.dialogTitle")}
                  description={t("refund.dialogDescription", {
                    amount: fmt(
                      refundEligibility.amount,
                      refundEligibility.currency,
                    ),
                  })}
                  submitLabel={t("refund.submit")}
                  cancelLabel={t("actions.cancel")}
                  submitting={submittingRefund}
                  onOpenChange={(open) => {
                    if (!open && !submittingRefund) setRefundDialogOpen(false);
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitRefundRequest();
                  }}
                >
                  <Field>
                    <FieldLabel htmlFor="vx-order-refund-reason">
                      {t("refund.reasonLabel")}
                    </FieldLabel>
                    <Input
                      id="vx-order-refund-reason"
                      value={refundReason}
                      onChange={(event) => setRefundReason(event.target.value)}
                      placeholder={t("refund.reasonPlaceholder")}
                      maxLength={512}
                    />
                  </Field>
                </DialogForm>
              ) : null}
            </PageSection>
          </aside>
        </div>
      ) : (
        <PageSection tone="raised" className={SECTION_TIGHT}>
          <EmptyState
            title={t(`stateTitle.${state}`)}
            description={t(`stateHint.${state}`)}
            action={
              <>
                <Button variant="outline" onClick={() => void reload()}>
                  {t("actions.refresh")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/subscription")}
                >
                  {t("actions.backToSubscription")}
                </Button>
              </>
            }
          />
        </PageSection>
      )}

      {declareOpen && detail ? (
        <DialogForm
          open
          title={
            fullVoucherCover
              ? t("declareDialog.titleInstant")
              : t("declareDialog.title")
          }
          description={t("declareDialog.description", {
            amount: fmt(cashDue, detail.currency),
            channel: t(`channels.${channel}`),
          })}
          submitLabel={
            fullVoucherCover
              ? t("actions.settleInstant")
              : t("declareDialog.confirm")
          }
          cancelLabel={t("declareDialog.cancel")}
          submitting={submitting}
          onOpenChange={(open: boolean) => {
            if (!open && !submitting) setDeclareOpen(false);
          }}
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            void handleDeclare();
          }}
        >
          {!fullVoucherCover ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="order-pay-payer">
                  {t("declareDialog.payerName")}
                </FieldLabel>
                <Input
                  id="order-pay-payer"
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder={t("declareDialog.payerPlaceholder")}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="order-pay-txn">
                  {t("declareDialog.transactionNo")}
                </FieldLabel>
                <Input
                  id="order-pay-txn"
                  value={transactionNo}
                  onChange={(e) => setTransactionNo(e.target.value)}
                  placeholder={t("declareDialog.optional")}
                />
              </Field>
            </FieldGroup>
          ) : null}
          {error ? <Banner tone="danger" title={error} /> : null}
        </DialogForm>
      ) : null}
    </ViewLayout>
  );
}
