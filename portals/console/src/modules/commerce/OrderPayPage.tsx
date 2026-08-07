"use client";

/**
 * OrderPayPage.tsx - 订单付款页（product_321 §6.1）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 同一路由按六态切换渲染：待付款（金额分解 + 券勾选 + 支付方式 + 申报）/
 * 已付款·待确认（轮询 + 手动刷新）/ 开通处理中（轮询）/ 终态视图。
 * 勾选变化调 quote 纯试算；「我已完成付款」弹 DS Dialog 确认后 declare。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import {
  Banner,
  Button,
  Checkbox,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  DialogForm,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
  Skeleton,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { PageSection } from "@/layout/shell";
import {
  ConsoleBffError,
  declareOrderPayment,
  fetchOrderDetail,
  quoteOrder,
  cancelSubscriptionOrder,
  type OrderDetail,
  type OrderQuote,
  type OrderState,
  type OrderVoucherOption,
  type PaymentChannelInfo,
} from "@/api/console-bff";

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

function fmt(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${currency === "CNY" ? "¥" : currency} ${n.toFixed(2)}`;
}

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
  const m = Math.floor(remain / 60_000);
  const s = Math.floor((remain % 60_000) / 1_000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function voucherLabel(
  v: OrderVoucherOption,
  t: ReturnType<typeof useTranslations>,
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
  return `${v.batchName} · ¥${Number(v.amount ?? 0).toFixed(2)}`;
}

export function OrderPayPage() {
  const t = useTranslations("orderPay");
  const router = useRouter();
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId ?? "";

  const [detail, setDetail] = useState<OrderDetail | null>(null);
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
      <ViewLayout>
        <ViewHeader icon="table" title={t("title")} description="" />
        <Skeleton />
      </ViewLayout>
    );
  }
  if (!detail) {
    return (
      <ViewLayout>
        <ViewHeader
          icon="table"
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

  const isPending = detail.orderState === "pending_payment";
  const fullVoucherCover = isPending && Number(cashDue) === 0;

  // 右栏：支付方式 + 操作
  const asideNode = (
    <div className="flex flex-col gap-lg">
      <PageSection
        tone="raised"
        icon="credit-card"
        level={2}
        title={t("channels.title")}
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
          <div className="flex justify-center rounded-lg bg-accent p-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activeChannel.qrAsset}
              alt={t("channels.alipayQrAlt")}
              className="h-auto w-media-3xl max-w-full"
            />
          </div>
        ) : null}

        {channel === "bank_transfer" && activeChannel?.account ? (
          <DetailList>
            <DetailRow label={t("bank.accountName")}>
              {activeChannel.account.accountName}
            </DetailRow>
            <DetailRow label={t("bank.bankName")}>
              {activeChannel.account.bankName}
            </DetailRow>
            <DetailRow label={t("bank.accountNo")}>
              {activeChannel.account.accountNo}
            </DetailRow>
          </DetailList>
        ) : null}

        <p className="text-body-sm text-muted-foreground">
          {detail.paymentChannels.every((c) => !c.enabled)
            ? t("channels.noneEnabled")
            : t("referenceNote", { orderNo: detail.orderNo })}
        </p>
      </PageSection>

      {error ? <Banner tone="danger" title={error} /> : null}

      <div className="flex flex-wrap items-center gap-sm">
        <Button
          onClick={() => {
            setError(null);
            setDeclareOpen(true);
          }}
          disabled={submitting || !quote}
        >
          {fullVoucherCover
            ? t("actions.settleInstant")
            : t("actions.declarePaid")}
        </Button>
        <Button
          variant="outline"
          onClick={() => void handleCancel()}
          disabled={submitting || Number(detail.paidAmount) > 0}
        >
          {t("actions.cancelOrder")}
        </Button>
      </div>
    </div>
  );

  return (
    <DetailPageTemplate
      header={
        <>
          <ViewHeader
            icon="table"
            title={t("title")}
            description={`${detail.orderNo} · ${t(`status.${detail.orderState}`)}`}
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
        </>
      }
      {...(isPending ? { aside: asideNode } : {})}
    >
      {isPending ? (
        <>
          {/* 左栏：订单 + 金额分解 */}
          <PageSection
            tone="raised"
            icon="package"
            level={2}
            title={`${detail.planName || detail.planCode}${
              detail.tier ? ` · ${detail.tier}` : ""
            }`}
          >
            <p className="text-body-sm text-muted-foreground">
              {t(`cycle.${detail.cycleUnit}` as never)} · {t("cycleStartNote")}
            </p>
          </PageSection>

          <PageSection
            tone="raised"
            icon="currency-cny"
            level={2}
            title={t("breakdown.title")}
          >
            <DetailList>
              <DetailRow label={t("breakdown.listPrice")}>
                {fmt(quote?.listPrice ?? detail.listPrice, detail.currency)}
              </DetailRow>

              <DetailRow
                label={t("breakdown.discountVoucher")}
                actions={
                  <span className="text-body-md text-success-text">
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
                      {voucherLabel(bestDiscount, t)}
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
                  <span className="text-body-md text-success-text">
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
                      {voucherLabel(bestCredit, t)}
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
                  <span className="text-success-text">
                    − {fmt(detail.paidAmount, detail.currency)}
                  </span>
                </DetailRow>
              ) : null}
            </DetailList>

            <div className="flex items-center justify-between gap-md border-t border-border pt-md">
              <strong className="text-label-lg text-foreground">
                {t("breakdown.cashDue")}
              </strong>
              <span className="text-heading-3 text-foreground">
                {fmt(cashDue, detail.currency)}
              </span>
            </div>
          </PageSection>
        </>
      ) : (
        <EmptyState
          title={
            <span className="flex flex-col items-center gap-xs">
              <StatusBadge tone={STATE_TONE[detail.orderState]}>
                {t(`status.${detail.orderState}`)}
              </StatusBadge>
              {t(`stateTitle.${detail.orderState}`)}
            </span>
          }
          description={t(`stateHint.${detail.orderState}`)}
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
    </DetailPageTemplate>
  );
}
