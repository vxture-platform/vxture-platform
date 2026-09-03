"use client";

/**
 * AddonPayPage.tsx — 加油包订单支付页(/quotas/addon-pay/[orderNo])。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 加油包走完整订单流程(2026-08-21 owner 定):卡片下单 → 本页付款申报 →
 * 运营核销 → 额度入池生效。结构与订阅单支付页(OrderPayPage)同构:
 * 四步流程条 + 订单摘要 + 支付渠道 + 转账申报;已申报轮询等核销,完成态回配额管理。
 * 状态映射:pending未申报→pending_payment / 已申报→paid_pending_verify /
 * completed→completed / cancelled→cancelled(过期由清扫转 cancelled)。
 *
 * 批 1:渠道面板 / 轮询 / 倒计时与订阅付款页共用(components/pay/*),补回此前
 * 这页缺的五项——加载骨架、in-flight 去重与焦点刷新、申报二次确认、取消的破坏性
 * 确认、BFF 报文透传;订单不存在与读取失败分开呈现。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DestructiveButton,
  DetailList,
  DetailRow,
  DialogForm,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Skeleton,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { StatusBadgeTone } from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  ConsoleBffError,
  cancelAddonOrder,
  declareAddonPayment,
  fetchAddonOrderDetail,
  type ConsoleAddonOrder,
  type PaymentChannelInfo,
} from "@/api/console-bff";
import { useRouter } from "@/lib/i18n/navigation";
import { useConfirmLabels } from "@/lib/destructive";
import { LoadFailedBanner } from "@/components/load/LoadFailed";
import { PageSection } from "@/layout/shell";
import {
  OrderFlowStrip,
  type OrderFlowStage,
} from "./components/OrderFlowStrip";
import { fmtDate, fmtTime } from "./components/hubModel";
import {
  PayChannelPanel,
  defaultPayChannel,
  type PayChannel,
} from "./components/pay/PayChannelPanel";
import { useCountdown } from "./components/pay/useCountdown";
import { useOrderPolling } from "./components/pay/useOrderPolling";
import { formatBytes } from "./QuotasPage";

const POLL_MS = 30_000;

const stageOf = (o: ConsoleAddonOrder): OrderFlowStage => {
  if (o.status === "completed") return "completed";
  if (o.status === "cancelled") return "cancelled";
  return o.paymentDeclared ? "paid_pending_verify" : "pending_payment";
};

const STATUS_TONE: Record<string, StatusBadgeTone> = {
  pending: "warning",
  declared: "info",
  completed: "success",
  cancelled: "neutral",
};

export function AddonPayPage({ orderNo }: { orderNo: string }) {
  const t = useTranslations("addonPay");
  const tChannels = useTranslations("payChannels");
  const withLabels = useConfirmLabels();
  const locale = useLocale();
  const router = useRouter();

  const [order, setOrder] = useState<ConsoleAddonOrder | null>(null);
  const [channels, setChannels] = useState<PaymentChannelInfo[]>([]);
  const [channel, setChannel] = useState<PayChannel>("bank_transfer");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payerName, setPayerName] = useState("");
  const [transactionNo, setTransactionNo] = useState("");
  const [declareOpen, setDeclareOpen] = useState(false);
  const inFlight = useRef(false);
  const defaultsApplied = useRef(false);

  const money = useCallback(
    (yuan: string, currency: string) =>
      formatCurrency(
        Number.parseFloat(yuan || "0"),
        locale as Locale,
        currency,
      ),
    [locale],
  );

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const detail = await fetchAddonOrderDetail(orderNo);
      setOrder(detail.order);
      setChannels(detail.paymentChannels);
      setNotFound(false);
      setLoadFailed(false);
      if (!defaultsApplied.current) {
        defaultsApplied.current = true;
        setChannel(defaultPayChannel(detail.paymentChannels));
      }
    } catch (err) {
      const status = err instanceof ConsoleBffError ? err.status : undefined;
      if (status === 400 || status === 403 || status === 404) setNotFound(true);
      else setLoadFailed(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [orderNo]);

  useEffect(() => {
    void load();
  }, [load]);

  // 已申报 → 轮询等运营核销;完成/取消即停
  const awaitingVerify =
    order?.status === "pending_payment" && order.paymentDeclared;
  useOrderPolling(Boolean(awaitingVerify), load, POLL_MS);

  // 付款截止倒计时(未申报待支付单);到点重取,让服务端的取消态显影
  const countdown = useCountdown(
    order?.status === "pending_payment" && !order.paymentDeclared
      ? order.expireAt
      : null,
    () => void load(),
  );
  const countdownExpired = countdown === "00:00";

  const handleDeclare = async () => {
    setBusy(true);
    setError(null);
    try {
      await declareAddonPayment(orderNo, {
        ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
        ...(transactionNo.trim()
          ? { transactionNo: transactionNo.trim() }
          : {}),
      });
      setDeclareOpen(false);
      await load();
    } catch (err) {
      setError(
        err instanceof ConsoleBffError && err.message
          ? err.message
          : t("declareFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  /** 取消:由 DestructiveButton 的确认件落锤;失败抛出让框不关。 */
  const handleCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelAddonOrder(orderNo);
      await load();
    } catch (err) {
      setError(
        err instanceof ConsoleBffError && err.message
          ? err.message
          : t("cancelFailed"),
      );
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const backButton = (
    <Button variant="outline" onClick={() => router.push("/quotas")}>
      {t("backToQuotas")}
    </Button>
  );

  if (loading && !order) {
    return (
      <ViewLayout>
        <ViewHeader icon="lightning" title={t("title")} description={orderNo} />
        <Skeleton className="h-media-lg w-full" />
        <Skeleton className="h-media-lg w-full" />
      </ViewLayout>
    );
  }

  if (notFound) {
    return (
      <ViewLayout>
        <ViewHeader icon="lightning" title={t("title")} description={orderNo} />
        <Banner tone="danger" title={t("notFound")} />
        <div>{backButton}</div>
      </ViewLayout>
    );
  }

  if (!order) {
    return (
      <ViewLayout>
        <ViewHeader icon="lightning" title={t("title")} description={orderNo} />
        <LoadFailedBanner onRetry={() => void load()} retrying={loading} />
        <div>{backButton}</div>
      </ViewLayout>
    );
  }

  const stage = stageOf(order);
  const statusKey =
    order.status === "completed"
      ? "completed"
      : order.status === "cancelled"
        ? "cancelled"
        : order.paymentDeclared
          ? "declared"
          : "pending";
  const canDeclare =
    order.status === "pending_payment" && !order.paymentDeclared;

  return (
    <ViewLayout>
      <ViewHeader
        icon="lightning"
        title={t("title")}
        description={t("description", { orderNo })}
        action={
          <StatusBadge tone={STATUS_TONE[statusKey] ?? "neutral"}>
            {t(`status.${statusKey}`)}
          </StatusBadge>
        }
      />

      <OrderFlowStrip
        stage={stage}
        times={{
          order: order.createdAt,
          provision: order.activatedAt,
        }}
      />

      {loadFailed ? (
        <LoadFailedBanner onRetry={() => void load()} retrying={loading} />
      ) : null}
      {error ? <Banner tone="danger" title={error} /> : null}
      {canDeclare && countdownExpired ? (
        <Banner tone="warning" title={t("expiredNotice")} />
      ) : null}

      {/* 订单摘要 */}
      <PageSection
        icon="receipt"
        level={2}
        title={t("summary.title")}
        description={t("summary.description")}
      >
        <DetailList>
          <DetailRow label={t("summary.pack")}>{order.packName}</DetailRow>
          <DetailRow label={t("summary.content")}>
            {order.metricKey === "storage.bytes"
              ? formatBytes(order.amount)
              : order.amount.toLocaleString(locale)}
          </DetailRow>
          <DetailRow label={t("summary.validity")}>
            {order.validUntil
              ? t("summary.validUntil", { date: fmtDate(order.validUntil) })
              : t("summary.validityDaysFromActivation", {
                  days: order.validityDays,
                })}
          </DetailRow>
          <DetailRow label={t("summary.amountDue")}>
            <strong className="tabular-nums">
              {money(order.price, order.currency)}
            </strong>
          </DetailRow>
          <DetailRow label={t("summary.billNo")}>
            {order.billNo ? (
              <span className="font-mono">{order.billNo}</span>
            ) : (
              "—"
            )}
          </DetailRow>
          <DetailRow label={t("summary.createdAt")}>
            {`${fmtDate(order.createdAt)} ${fmtTime(order.createdAt)}`}
          </DetailRow>
        </DetailList>
      </PageSection>

      {/* 支付与申报(仅未申报的待支付单) */}
      {canDeclare ? (
        <PageSection
          icon="credit-card"
          level={2}
          title={t("pay.title")}
          description={
            countdown
              ? t("pay.deadline", { remain: countdown })
              : t("pay.description")
          }
        >
          <PayChannelPanel
            channels={channels}
            value={channel}
            onChange={setChannel}
            orderNo={orderNo}
          />

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="addon-pay-payer">
                {t("declare.payerName")}
              </FieldLabel>
              <Input
                id="addon-pay-payer"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder={t("declare.payerNamePlaceholder")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="addon-pay-txn">
                {t("declare.transactionNo")}
              </FieldLabel>
              <Input
                id="addon-pay-txn"
                value={transactionNo}
                onChange={(e) => setTransactionNo(e.target.value)}
                placeholder={t("declare.transactionNoPlaceholder")}
              />
            </Field>
          </FieldGroup>

          <div className="flex items-center justify-end gap-sm">
            <DestructiveButton
              size="md"
              disabled={busy}
              confirm={withLabels({
                verb: t("cancelConfirm.verb"),
                target: orderNo,
                consequence: t("cancelConfirm.consequence"),
                onConfirm: handleCancel,
              })}
            >
              {t("cancelOrder")}
            </DestructiveButton>
            <Button
              disabled={busy}
              onClick={() => {
                setError(null);
                setDeclareOpen(true);
              }}
            >
              {t("declare.submit")}
            </Button>
          </div>
        </PageSection>
      ) : null}

      {/* 已申报待核销 */}
      {awaitingVerify ? (
        <Banner tone="info" title={t("declared.note")} />
      ) : null}

      {/* 完成 / 取消态 */}
      {order.status === "completed" ? (
        <Banner
          tone="success"
          title={t("completed.note", {
            date: order.validUntil ? fmtDate(order.validUntil) : "—",
          })}
        />
      ) : null}
      {order.status === "cancelled" ? (
        <Banner tone="warning" title={t("cancelled.note")} />
      ) : null}

      <div>{backButton}</div>

      {declareOpen ? (
        <DialogForm
          open
          title={t("declareDialog.title")}
          description={t("declareDialog.description", {
            amount: money(order.price, order.currency),
            channel: tChannels(`channel.${channel}`),
          })}
          submitLabel={t("declareDialog.confirm")}
          cancelLabel={t("declareDialog.cancel")}
          submitting={busy}
          onOpenChange={(open: boolean) => {
            if (!open && !busy) setDeclareOpen(false);
          }}
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            void handleDeclare();
          }}
        >
          <p className="text-body-sm text-muted-foreground">
            {t("pay.referenceNote", { orderNo })}
          </p>
        </DialogForm>
      ) : null}
    </ViewLayout>
  );
}
