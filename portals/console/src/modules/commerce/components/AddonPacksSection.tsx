"use client";

/**
 * AddonPacksSection.tsx — 加油包/扩展包购买区(配额管理页组合件)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 自助购买闭环的 console 端(owner 2026-08-20):选包下单 → 弹出对公转账
 * 信息 + 转账申报(付款人/流水号)→ 运营核销后额度自动入池。订单表内闭环,
 * 不进「我的订单」订阅单列表(v1 边界,合并展示登记后置)。
 * DS 组合件拼装(Dialog/DataTable/StatusBadge/Banner),无自造样式层。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DataTable,
  DetailList,
  DetailRow,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldLabel,
  Input,
  StatusBadge,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import {
  cancelAddonOrder,
  createAddonOrder,
  declareAddonPayment,
  fetchAddonOrders,
  fetchAddonPacks,
  fetchAddonPaymentChannels,
  type ConsoleAddonOrder,
  type ConsoleAddonPack,
  type PaymentChannelInfo,
} from "@/api/console-bff";
import { PageSection } from "@/layout/shell";
import { fmtDate, fmtTime } from "./hubModel";
import { formatBytes } from "../QuotasPage";

const fmtCount = (v: number): string => v.toLocaleString("en-US");

/** 包内容展示:存储字节格式化,credits 计数。 */
const packAmount = (metricKey: string, amount: number): string =>
  metricKey === "storage.bytes" ? formatBytes(amount) : fmtCount(amount);

type DeclareTarget = {
  orderNo: string;
  packName: string;
  price: string;
  currency: string;
  channels: PaymentChannelInfo[];
};

export function AddonPacksSection({
  onSettledRefresh,
  formatMoney,
}: {
  /** 订单状态变化后让父页刷新配额总览(额度入池后立即可见)。 */
  onSettledRefresh: () => void;
  formatMoney: (yuan: string, currency: string) => string;
}) {
  const t = useTranslations("quotasPage.addons");

  const [packs, setPacks] = useState<ConsoleAddonPack[]>([]);
  const [orders, setOrders] = useState<ConsoleAddonOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declareTarget, setDeclareTarget] = useState<DeclareTarget | null>(
    null,
  );
  const [payerName, setPayerName] = useState("");
  const [transactionNo, setTransactionNo] = useState("");
  const [declaring, setDeclaring] = useState(false);

  const reload = useCallback(() => {
    return Promise.all([fetchAddonPacks(), fetchAddonOrders()]).then(
      ([packRows, orderRows]) => {
        setPacks(packRows);
        setOrders(orderRows);
      },
    );
  }, []);

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [reload]);

  const hasPendingFor = (packCode: string): boolean =>
    orders.some(
      (o) => o.packCode === packCode && o.status === "pending_payment",
    );

  const handleBuy = async (pack: ConsoleAddonPack) => {
    setError(null);
    setBusyPack(pack.packCode);
    try {
      const { order, paymentChannels } = await createAddonOrder(pack.packCode);
      await reload();
      setPayerName("");
      setTransactionNo("");
      setDeclareTarget({
        orderNo: order.orderNo,
        packName: order.packName,
        price: order.price,
        currency: order.currency,
        channels: paymentChannels,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("buyFailed"));
    } finally {
      setBusyPack(null);
    }
  };

  const openDeclare = async (order: ConsoleAddonOrder) => {
    setError(null);
    const channels = await fetchAddonPaymentChannels(order.orderNo);
    setPayerName("");
    setTransactionNo("");
    setDeclareTarget({
      orderNo: order.orderNo,
      packName: order.packName,
      price: order.price,
      currency: order.currency,
      channels,
    });
  };

  const handleDeclare = async () => {
    if (!declareTarget) return;
    setDeclaring(true);
    try {
      const ok = await declareAddonPayment(declareTarget.orderNo, {
        ...(payerName.trim() ? { payerName: payerName.trim() } : {}),
        ...(transactionNo.trim()
          ? { transactionNo: transactionNo.trim() }
          : {}),
      });
      if (!ok) {
        setError(t("declareFailed"));
        return;
      }
      setDeclareTarget(null);
      await reload();
    } finally {
      setDeclaring(false);
    }
  };

  const handleCancel = async (order: ConsoleAddonOrder) => {
    setError(null);
    const ok = await cancelAddonOrder(order.orderNo);
    if (!ok) setError(t("cancelFailed"));
    await reload();
    onSettledRefresh();
  };

  // ── 包目录表 ──────────────────────────────────────────────────────────────
  const packColumns: DataTableColumn<ConsoleAddonPack>[] = [
    {
      id: "pack",
      header: t("colPack"),
      cell: (p) => (
        <span className="flex flex-col">
          <span className="text-foreground">{p.packName}</span>
          <span className="font-mono text-body-sm text-muted-foreground">
            {p.packCode}
          </span>
        </span>
      ),
    },
    {
      id: "content",
      header: t("colContent"),
      align: "right",
      cell: (p) => (
        <span className="tabular-nums">
          {packAmount(p.metricKey, p.amount)}
        </span>
      ),
    },
    {
      id: "validity",
      header: t("colValidity"),
      align: "right",
      cell: (p) => t("validityDays", { days: p.validityDays }),
    },
    {
      id: "price",
      header: t("colPrice"),
      align: "right",
      cell: (p) => (
        <span className="tabular-nums font-medium text-foreground">
          {formatMoney(p.price, p.currency)}
        </span>
      ),
    },
    {
      id: "buy",
      header: "",
      align: "right",
      cell: (p) => (
        <Button
          size="sm"
          variant="outline"
          disabled={busyPack !== null || hasPendingFor(p.packCode)}
          onClick={() => void handleBuy(p)}
        >
          {hasPendingFor(p.packCode) ? t("pendingExists") : t("buy")}
        </Button>
      ),
    },
  ];

  // ── 订单表 ────────────────────────────────────────────────────────────────
  const orderStatus = (
    o: ConsoleAddonOrder,
  ): { tone: StatusBadgeTone; label: string } => {
    if (o.status === "completed")
      return { tone: "success", label: t("statusCompleted") };
    if (o.status === "cancelled")
      return { tone: "neutral", label: t("statusCancelled") };
    return o.paymentDeclared
      ? { tone: "info", label: t("statusDeclared") }
      : { tone: "warning", label: t("statusPending") };
  };

  const orderColumns: DataTableColumn<ConsoleAddonOrder>[] = [
    {
      id: "order",
      header: t("colOrder"),
      cell: (o) => (
        <span className="flex flex-col">
          <span className="font-mono text-label-md text-foreground">
            {o.orderNo}
          </span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {fmtDate(o.createdAt)} {fmtTime(o.createdAt)}
          </span>
        </span>
      ),
    },
    {
      id: "pack",
      header: t("colPack"),
      cell: (o) => (
        <span className="flex flex-col">
          <span className="text-foreground">{o.packName}</span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {packAmount(o.metricKey, o.amount)}
          </span>
        </span>
      ),
    },
    {
      id: "price",
      header: t("colPrice"),
      align: "right",
      cell: (o) => (
        <span className="tabular-nums font-medium text-foreground">
          {formatMoney(o.price, o.currency)}
        </span>
      ),
    },
    {
      id: "status",
      header: t("colStatus"),
      align: "center",
      cell: (o) => {
        const s = orderStatus(o);
        return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
      },
    },
    {
      id: "note",
      header: t("colNote"),
      cell: (o) => {
        if (o.status === "completed" && o.validUntil) {
          return (
            <span className="tabular-nums text-body-sm text-muted-foreground">
              {t("validUntil", { date: fmtDate(o.validUntil) })}
            </span>
          );
        }
        if (
          o.status === "pending_payment" &&
          !o.paymentDeclared &&
          o.expireAt
        ) {
          return (
            <span className="tabular-nums text-body-sm text-muted-foreground">
              {t("payBefore", {
                date: `${fmtDate(o.expireAt)} ${fmtTime(o.expireAt)}`,
              })}
            </span>
          );
        }
        if (o.status === "pending_payment" && o.paymentDeclared) {
          return (
            <span className="text-body-sm text-muted-foreground">
              {t("awaitingConfirm")}
            </span>
          );
        }
        return "—";
      },
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (o) =>
        o.status === "pending_payment" && !o.paymentDeclared ? (
          <span className="flex items-center justify-end gap-xs">
            <Button size="sm" onClick={() => void openDeclare(o)}>
              {t("declare")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleCancel(o)}
            >
              {t("cancel")}
            </Button>
          </span>
        ) : null,
    },
  ];

  const bank = declareTarget?.channels.find(
    (c) => c.channel === "bank_transfer" && c.enabled,
  )?.account;

  return (
    <PageSection
      icon="lightning"
      level={2}
      title={t("title")}
      description={t("description")}
    >
      {error ? <Banner tone="danger" title={error} /> : null}

      <DataTable<ConsoleAddonPack>
        columns={packColumns}
        rows={packs}
        rowKey={(p) => p.packCode}
        loading={loading}
        empty={<EmptyState title={t("packsEmpty")} />}
      />

      {orders.length > 0 || loading ? (
        <DataTable<ConsoleAddonOrder>
          columns={orderColumns}
          rows={orders}
          rowKey={(o) => o.orderNo}
          loading={loading}
          empty={<EmptyState title={t("ordersEmpty")} />}
        />
      ) : null}

      {/* 转账申报弹窗:对公收款信息 + 付款人/流水号 */}
      <Dialog
        open={declareTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeclareTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("declareTitle")}</DialogTitle>
            <DialogDescription>
              {declareTarget
                ? t("declareDescription", {
                    pack: declareTarget.packName,
                    price: formatMoney(
                      declareTarget.price,
                      declareTarget.currency,
                    ),
                  })
                : null}
            </DialogDescription>
          </DialogHeader>

          {bank ? (
            <DetailList>
              <DetailRow label={t("bankAccountName")}>
                {bank.accountName}
              </DetailRow>
              <DetailRow label={t("bankName")}>{bank.bankName}</DetailRow>
              <DetailRow label={t("bankAccountNo")}>
                <span className="font-mono">{bank.accountNo}</span>
              </DetailRow>
              <DetailRow label={t("bankReference")}>
                <span className="font-mono">{bank.reference}</span>
              </DetailRow>
            </DetailList>
          ) : (
            <Banner tone="info" title={t("bankUnavailable")} />
          )}

          <div className="flex flex-col gap-sm">
            <div className="flex flex-col gap-xs">
              <FieldLabel htmlFor="addon-payer-name">
                {t("payerName")}
              </FieldLabel>
              <Input
                id="addon-payer-name"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                placeholder={t("payerNamePlaceholder")}
              />
            </div>
            <div className="flex flex-col gap-xs">
              <FieldLabel htmlFor="addon-transaction-no">
                {t("transactionNo")}
              </FieldLabel>
              <Input
                id="addon-transaction-no"
                value={transactionNo}
                onChange={(e) => setTransactionNo(e.target.value)}
                placeholder={t("transactionNoPlaceholder")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeclareTarget(null)}
              disabled={declaring}
            >
              {t("declareLater")}
            </Button>
            <Button onClick={() => void handleDeclare()} disabled={declaring}>
              {t("declareSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
