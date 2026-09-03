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
  DestructiveButton,
  DetailList,
  DetailRow,
  DialogForm,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  NativeSelect,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  Skeleton,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { useConfirmLabels } from "@/lib/destructive";
import {
  PayChannelPanel,
  defaultPayChannel,
  type PayChannel,
} from "./components/pay/PayChannelPanel";
import { useCountdown } from "./components/pay/useCountdown";
import { useOrderPolling } from "./components/pay/useOrderPolling";
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

/** 货币展示统一走 shared formatCurrency（110-locale-layer 指定入口）。 */
function fmtWith(locale: Locale) {
  return (amount: string, currency: string): string => {
    const n = Number(amount);
    if (!Number.isFinite(n)) return "—";
    return formatCurrency(n, locale, currency);
  };
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
        : // fixed 面值服务端已换算成元(与卡券页同口径,批 1)
          t("voucher.fixedOff", {
            value: (v.discountValue ?? 0).toFixed(2),
          });
    return `${v.batchName} · ${off}`;
  }
  return `${v.batchName} · ${fmt(String(v.amount ?? 0), "CNY")}`;
}

/**
 * 券选择:一张 = 勾选框;多张 = 下拉(含「不使用」)。此前只画第一张,其余券在
 * detail.vouchers 里是死数据,客户手里有两张折扣券也只能用服务端排在前面的那张。
 */
function VoucherChoice({
  id,
  options,
  value,
  onChange,
  label,
  t,
  fmt,
}: {
  id: string;
  options: OrderVoucherOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  label: string;
  t: ReturnType<typeof useTranslations>;
  fmt: (amount: string, currency: string) => string;
}) {
  if (options.length === 1) {
    const only = options[0]!;
    return (
      <Field orientation="horizontal" className="w-auto">
        <Checkbox
          id={id}
          checked={value === only.voucherId}
          onCheckedChange={(checked) =>
            onChange(checked === true ? only.voucherId : null)
          }
        />
        <FieldLabel htmlFor={id}>{voucherLabel(only, t, fmt)}</FieldLabel>
      </Field>
    );
  }
  return (
    <NativeSelect
      id={id}
      aria-label={label}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{t("breakdown.noneOption")}</option>
      {options.map((v) => (
        <option key={v.voucherId} value={v.voucherId}>
          {voucherLabel(v, t, fmt)}
        </option>
      ))}
    </NativeSelect>
  );
}

export function OrderPayPage() {
  const t = useTranslations("orderPay");
  const fmt = fmtWith(useLocale() as Locale);
  const withLabels = useConfirmLabels();
  const tChannels = useTranslations("payChannels");
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
  /* 读失败显影(批 1):400/404 = 订单不存在;其余 = 读取失败 + 重试。此前两者
   * 一律回 null 画成「订单不存在」。 */
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
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
      setNotFound(false);
      setLoadFailed(false);
    } catch (err) {
      const status = err instanceof ConsoleBffError ? err.status : undefined;
      if (status === 400 || status === 403 || status === 404) setNotFound(true);
      else setLoadFailed(true);
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
    setChannel(defaultPayChannel(detail.paymentChannels));
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
          setError(
            err instanceof Error && err.message
              ? err.message
              : t("errors.quote"),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail, discountId, creditId, t]);

  // Poll while awaiting confirmation / activation (shared hook: interval +
  // focus/visibility triggers; in-flight dedupe lives in reload).
  const polling =
    detail?.orderState === "paid_pending_verify" ||
    detail?.orderState === "activating";
  useOrderPolling(polling, reload, POLL_MS);

  // 倒计时到点:重取订单,让服务端的 expired 态显影(此前停在「00:00」还能点申报)。
  const countdown = useCountdown(
    detail?.orderState === "pending_payment" ? detail.expireAt : null,
    () => void reload(),
  );
  const countdownExpired = countdown === "00:00";

  const discountVouchers = useMemo(
    () => detail?.vouchers.filter((v) => v.kind === "discount") ?? [],
    [detail],
  );
  const creditVouchers = useMemo(
    () => detail?.vouchers.filter((v) => v.kind === "credit_voucher") ?? [],
    [detail],
  );
  // 应付 = 试算结果;报价未到就是「试算中」,不拿原价冒充(原价不含券与已付)。
  const cashDue = quote?.cashDue ?? null;

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
      // activated(0 元 / 券全额覆盖即时结清)也留在本页:重取后进入完成视图,
      // 成功页与 24h 退款入口才看得到——此前直接跳走,两样都不可达。
      void result;
      await reload();
    } catch (err) {
      setError(
        err instanceof ConsoleBffError && err.message
          ? err.message
          : t("errors.declare"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  /** 取消订单:由 DestructiveButton 的确认件落锤;失败抛出让框不关。 */
  async function handleCancel() {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelSubscriptionOrder(detail.orderId);
      await reload();
    } catch (err) {
      setError(
        err instanceof ConsoleBffError && err.message
          ? err.message
          : t("errors.cancel"),
      );
      throw err;
    } finally {
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
  if (notFound || (!detail && !loadFailed)) {
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
  if (!detail) {
    return (
      <ViewLayout className="mx-auto w-full max-w-content-base-xl">
        <ViewHeader icon="credit-card" title={t("title")} description="" />
        <LoadFailedBanner onRetry={() => void reload()} retrying={loading} />
      </ViewLayout>
    );
  }

  const state = detail.orderState;
  const isPending = state === "pending_payment";
  const fullVoucherCover =
    isPending && cashDue !== null && Number(cashDue) === 0;

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
      {loadFailed ? (
        <LoadFailedBanner onRetry={() => void reload()} retrying={loading} />
      ) : null}
      {detail.rejectReason && isPending ? (
        <Banner
          tone="danger"
          title={t("rejectBanner", { reason: detail.rejectReason })}
        />
      ) : null}
      {isPending && countdownExpired ? (
        <Banner tone="warning" title={t("expiredNotice")} />
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
            <PayChannelPanel
              channels={detail.paymentChannels}
              value={channel}
              onChange={setChannel}
              orderNo={detail.orderNo}
            />

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
                  {cashDue !== null
                    ? fmt(cashDue, detail.currency)
                    : t("amountPending")}
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
                  {discountVouchers.length > 0 ? (
                    <VoucherChoice
                      id="order-pay-discount"
                      options={discountVouchers}
                      value={discountId}
                      onChange={setDiscountId}
                      label={t("breakdown.pickDiscount")}
                      t={t}
                      fmt={fmt}
                    />
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
                  {creditVouchers.length > 0 ? (
                    <VoucherChoice
                      id="order-pay-credit"
                      options={creditVouchers}
                      value={creditId}
                      onChange={setCreditId}
                      label={t("breakdown.pickCredit")}
                      t={t}
                      fmt={fmt}
                    />
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
                {/* 取消是不可逆动作:走 DS 破坏性确认(此前单击即取消并跳走)。 */}
                <DestructiveButton
                  size="lg"
                  className="w-full"
                  disabled={
                    submitting ||
                    Number(detail.paidAmount) > 0 ||
                    !canManageBilling
                  }
                  confirm={withLabels({
                    verb: t("cancelConfirm.verb"),
                    target: detail.orderNo,
                    consequence: t("cancelConfirm.consequence"),
                    onConfirm: handleCancel,
                  })}
                >
                  {t("actions.cancelOrder")}
                </DestructiveButton>
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
            amount: fmt(cashDue ?? "0", detail.currency),
            channel: tChannels(`channel.${channel}`),
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
