"use client";

/**
 * AddonPayPage.tsx — 加油包订单支付页(/quotas/addon-pay/[orderNo])。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 加油包走完整订单流程(2026-08-21 owner 定):卡片下单 → 本页付款申报 →
 * 运营核销 → 额度入池生效。结构与订阅单支付页(OrderPayPage)同构:
 * 四步流程条 + 订单摘要 + 支付渠道(支付宝二维码/对公转账,同一套 env 配置)
 * + 转账申报表单;已申报轮询等核销,完成态回配额管理。
 * 状态映射:pending未申报→pending_payment / 已申报→paid_pending_verify /
 * completed→completed / cancelled→cancelled(过期由清扫转 cancelled)。
 */

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DetailList,
  DetailRow,
  FieldLabel,
  Input,
  SegmentedControl,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type { StatusBadgeTone } from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture/shared";
import {
  cancelAddonOrder,
  declareAddonPayment,
  fetchAddonOrderDetail,
  type ConsoleAddonOrder,
  type PaymentChannelInfo,
} from "@/api/console-bff";
import { useRouter } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import {
  OrderFlowStrip,
  type OrderFlowStage,
} from "./components/OrderFlowStrip";
import { fmtDate, fmtTime, formatRemain } from "./components/hubModel";
import { formatBytes } from "./QuotasPage";

const POLL_MS = 30_000;

type PayChannel = "alipay" | "bank_transfer";

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
  const locale = useLocale();
  const router = useRouter();

  const [order, setOrder] = useState<ConsoleAddonOrder | null>(null);
  const [channels, setChannels] = useState<PaymentChannelInfo[]>([]);
  const [channel, setChannel] = useState<PayChannel>("bank_transfer");
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payerName, setPayerName] = useState("");
  const [transactionNo, setTransactionNo] = useState("");
  const [now, setNow] = useState(() => Date.now());

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
    const detail = await fetchAddonOrderDetail(orderNo);
    if (!detail) {
      setMissing(true);
      return;
    }
    setOrder(detail.order);
    setChannels(detail.paymentChannels);
    const bank = detail.paymentChannels.find(
      (c) => c.channel === "bank_transfer" && c.enabled,
    );
    const alipay = detail.paymentChannels.find(
      (c) => c.channel === "alipay" && c.enabled,
    );
    if (!bank && alipay) setChannel("alipay");
  }, [orderNo]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // 已申报 → 轮询等运营核销;完成/取消即停
  useEffect(() => {
    if (!order || order.status !== "pending_payment" || !order.paymentDeclared)
      return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [order, load]);

  // 付款截止倒计时(未申报待支付单)
  useEffect(() => {
    if (!order?.expireAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [order?.expireAt]);

  const handleDeclare = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await declareAddonPayment(orderNo, {
        ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
        ...(transactionNo.trim()
          ? { transactionNo: transactionNo.trim() }
          : {}),
      });
      if (!ok) {
        setError(t("declareFailed"));
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await cancelAddonOrder(orderNo);
      if (!ok) {
        setError(t("cancelFailed"));
        return;
      }
      router.push("/quotas");
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <ViewLayout>
        <ViewHeader icon="lightning" title={t("title")} description={orderNo} />
        <Banner tone="danger" title={t("notFound")} />
        <div>
          <Button variant="outline" onClick={() => router.push("/quotas")}>
            {t("backToQuotas")}
          </Button>
        </div>
      </ViewLayout>
    );
  }

  const stage = order ? stageOf(order) : "pending_payment";
  const statusKey = !order
    ? "pending"
    : order.status === "completed"
      ? "completed"
      : order.status === "cancelled"
        ? "cancelled"
        : order.paymentDeclared
          ? "declared"
          : "pending";
  const activeChannel = channels.find((c) => c.channel === channel);
  const bankAccount = channels.find(
    (c) => c.channel === "bank_transfer" && c.enabled,
  )?.account;

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
          order: order?.createdAt ?? null,
          provision: order?.activatedAt ?? null,
        }}
      />

      {error ? <Banner tone="danger" title={error} /> : null}

      {/* 订单摘要 */}
      <PageSection
        icon="receipt"
        level={2}
        title={t("summary.title")}
        description={t("summary.description")}
      >
        <DetailList>
          <DetailRow label={t("summary.pack")}>
            {order ? order.packName : "—"}
          </DetailRow>
          <DetailRow label={t("summary.content")}>
            {order
              ? order.metricKey === "storage.bytes"
                ? formatBytes(order.amount)
                : order.amount.toLocaleString("en-US")
              : "—"}
          </DetailRow>
          <DetailRow label={t("summary.validity")}>
            {order
              ? order.validUntil
                ? t("summary.validUntil", { date: fmtDate(order.validUntil) })
                : t("summary.validityDaysFromActivation", {
                    days: order.validityDays,
                  })
              : "—"}
          </DetailRow>
          <DetailRow label={t("summary.amountDue")}>
            <strong className="tabular-nums">
              {order ? money(order.price, order.currency) : "—"}
            </strong>
          </DetailRow>
          <DetailRow label={t("summary.billNo")}>
            {order?.billNo ? (
              <span className="font-mono">{order.billNo}</span>
            ) : (
              "—"
            )}
          </DetailRow>
          <DetailRow label={t("summary.createdAt")}>
            {order
              ? `${fmtDate(order.createdAt)} ${fmtTime(order.createdAt)}`
              : "—"}
          </DetailRow>
        </DetailList>
      </PageSection>

      {/* 支付与申报(仅未申报的待支付单) */}
      {order && order.status === "pending_payment" && !order.paymentDeclared ? (
        <PageSection
          icon="credit-card"
          level={2}
          title={t("pay.title")}
          description={
            order.expireAt
              ? t("pay.deadline", {
                  remain: formatRemain(order.expireAt, now),
                })
              : t("pay.description")
          }
        >
          <SegmentedControl<PayChannel>
            ariaLabel={t("pay.channelLabel")}
            value={channel}
            onChange={setChannel}
            items={channels
              .filter((c) => c.channel !== "wechat")
              .map((c) => ({
                value: c.channel as PayChannel,
                label: `${t(`channels.${c.channel}`)}${
                  c.enabled ? "" : ` · ${t("channels.comingSoon")}`
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
                {t("pay.referenceNote", { orderNo })}
              </p>
            </div>
          ) : null}

          {channel === "bank_transfer" ? (
            bankAccount ? (
              <DetailList>
                <DetailRow label={t("bank.accountName")}>
                  {bankAccount.accountName}
                </DetailRow>
                <DetailRow label={t("bank.bankName")}>
                  {bankAccount.bankName}
                </DetailRow>
                <DetailRow label={t("bank.accountNo")}>
                  <span className="font-mono">{bankAccount.accountNo}</span>
                </DetailRow>
                <DetailRow label={t("bank.reference")}>
                  <span className="font-mono">{bankAccount.reference}</span>
                </DetailRow>
              </DetailList>
            ) : (
              <Banner tone="info" title={t("bank.unavailable")} />
            )
          ) : null}

          <div className="flex flex-col gap-sm">
            <div className="flex flex-col gap-xs">
              <FieldLabel htmlFor="addon-pay-payer">
                {t("declare.payerName")}
              </FieldLabel>
              <Input
                id="addon-pay-payer"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder={t("declare.payerNamePlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-xs">
              <FieldLabel htmlFor="addon-pay-txn">
                {t("declare.transactionNo")}
              </FieldLabel>
              <Input
                id="addon-pay-txn"
                value={transactionNo}
                onChange={(e) => setTransactionNo(e.target.value)}
                placeholder={t("declare.transactionNoPlaceholder")}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-sm">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void handleCancel()}
            >
              {t("cancelOrder")}
            </Button>
            <Button disabled={busy} onClick={() => void handleDeclare()}>
              {t("declare.submit")}
            </Button>
          </div>
        </PageSection>
      ) : null}

      {/* 已申报待核销 */}
      {order && order.status === "pending_payment" && order.paymentDeclared ? (
        <Banner tone="info" title={t("declared.note")} />
      ) : null}

      {/* 完成 / 取消态 */}
      {order?.status === "completed" ? (
        <Banner
          tone="success"
          title={t("completed.note", {
            date: order.validUntil ? fmtDate(order.validUntil) : "—",
          })}
        />
      ) : null}
      {order?.status === "cancelled" ? (
        <Banner tone="warning" title={t("cancelled.note")} />
      ) : null}

      {!loading ? (
        <div>
          <Button variant="outline" onClick={() => router.push("/quotas")}>
            {t("backToQuotas")}
          </Button>
        </div>
      ) : null}
    </ViewLayout>
  );
}
