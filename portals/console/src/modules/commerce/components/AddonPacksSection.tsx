"use client";

/**
 * AddonPacksSection.tsx — 加油包/扩展包购买区(配额管理页组合件)。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 2026-08-21 owner 整改:加油包是我们的**服务**,必须卡片模式(不做表格目录),
 * 且走完整订单流程——卡片「购买」下单 → 跳 /quotas/addon-pay/[orderNo] 支付页
 * (四步流程条:下单→付款→收款→开通)→ 运营核销 → 额度入池生效。
 * 本区 = 服务卡片栅格(3/行,与订阅 hub 卡同构)+ 订单记录表(序号列 +
 * 单操作列:去支付主按钮 + ⋯ 取消,遵守表格规范)。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardFooter,
  DataTable,
  EmptyState,
  Icon,
  StatusBadge,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  IconName,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  cancelAddonOrder,
  createAddonOrder,
  fetchAddonOrders,
  fetchAddonPacks,
  type ConsoleAddonOrder,
  type ConsoleAddonPack,
} from "@/api/console-bff";
import { useRouter } from "@/lib/i18n/navigation";
import { PageSection } from "@/layout/shell";
import { fmtDate, fmtTime } from "./hubModel";
import { formatBytes } from "../QuotasPage";
import { useConfirmLabels } from "@/lib/destructive";

const fmtCount = (v: number): string => v.toLocaleString("en-US");

/** 包内容展示:存储字节格式化,credits 计数。 */
const packAmount = (metricKey: string, amount: number): string =>
  metricKey === "storage.bytes" ? formatBytes(amount) : fmtCount(amount);

const PACK_ICON: Record<string, IconName> = {
  "storage.bytes": "hard-drive",
  "ai.credit": "sparkles",
};

// ============================================================================
// 服务卡片
// ============================================================================

function AddonPackCard({
  pack,
  pendingOrderNo,
  busy,
  onBuy,
  onContinue,
  formatMoney,
}: {
  pack: ConsoleAddonPack;
  /** 该包已有待支付单 → 卡片主操作变「继续支付」 */
  pendingOrderNo: string | null;
  busy: boolean;
  onBuy: (pack: ConsoleAddonPack) => void;
  onContinue: (orderNo: string) => void;
  formatMoney: (yuan: string, currency: string) => string;
}) {
  const t = useTranslations("quotasPage.addons");
  return (
    <Card surface="base" className="gap-md py-lg">
      <CardContent className="flex flex-1 flex-col gap-md">
        <div className="flex items-center gap-md">
          <span className="flex size-control-md items-center justify-center rounded-md bg-accent text-foreground">
            <Icon
              name={PACK_ICON[pack.metricKey] ?? "lightning"}
              size="sm"
              fallback="lightning"
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label-md text-foreground">
              {pack.packName}
            </span>
            <span className="block truncate font-mono text-body-sm text-muted-foreground">
              {pack.packCode}
            </span>
          </span>
          <Badge variant="outline">
            {pack.metricKey === "storage.bytes"
              ? t("kindStorage")
              : t("kindCredits")}
          </Badge>
        </div>

        <div className="flex items-baseline gap-xs">
          <strong className="text-title-md text-foreground tabular-nums">
            {packAmount(pack.metricKey, pack.amount)}
          </strong>
          <span className="text-body-sm text-muted-foreground">
            {t("validityDays", { days: pack.validityDays })}
          </span>
        </div>

        <div className="mt-auto flex items-baseline gap-xs pt-sm">
          <strong className="text-title-sm text-foreground tabular-nums">
            {formatMoney(pack.price, pack.currency)}
          </strong>
          <span className="text-body-sm text-muted-foreground">
            {t("oneOffNote")}
          </span>
        </div>
      </CardContent>

      <CardFooter className="justify-end gap-md">
        {pendingOrderNo ? (
          <Button size="sm" onClick={() => onContinue(pendingOrderNo)}>
            {t("continuePay")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onBuy(pack)}
          >
            {t("buy")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// ============================================================================
// 区块
// ============================================================================

export function AddonPacksSection({
  onSettledRefresh,
  formatMoney,
}: {
  /** 订单状态变化后让父页刷新配额总览(额度入池后立即可见)。 */
  onSettledRefresh: () => void;
  formatMoney: (yuan: string, currency: string) => string;
}) {
  const t = useTranslations("quotasPage.addons");
  const withLabels = useConfirmLabels();
  const router = useRouter();

  const [packs, setPacks] = useState<ConsoleAddonPack[]>([]);
  const [orders, setOrders] = useState<ConsoleAddonOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const pendingOrderFor = (packCode: string): string | null =>
    orders.find(
      (o) => o.packCode === packCode && o.status === "pending_payment",
    )?.orderNo ?? null;

  const goPay = (orderNo: string) =>
    router.push(`/quotas/addon-pay/${orderNo}`);

  const handleBuy = async (pack: ConsoleAddonPack) => {
    setError(null);
    setBusy(true);
    try {
      // 完整订单流程:下单即建单,支付/申报在订单支付页完成
      const { order } = await createAddonOrder(pack.packCode);
      goPay(order.orderNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("buyFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (order: ConsoleAddonOrder) => {
    setError(null);
    const ok = await cancelAddonOrder(order.orderNo);
    await reload();
    onSettledRefresh();
    /* 失败要抛：`cancelAddonOrder` 把异常吞成 boolean，直接返回会让 DS 的确认件
       把一次失败的取消当成成功、把框关掉。理由仍落在 `error` 横幅上。 */
    if (!ok) {
      setError(t("cancelFailed"));
      throw new Error(t("cancelFailed"));
    }
  };

  // ── 订单记录表(序号列 + 单操作列,遵守表格规范)──────────────────────────
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
  ];

  const orderMenuItems = (o: ConsoleAddonOrder): ActionMenuItem[] => [
    {
      id: "detail",
      label: t("orderDetail"),
      onSelect: () => goPay(o.orderNo),
    },
    {
      id: "cancel",
      label: t("cancel"),
      disabled: o.status !== "pending_payment",
      ...(o.status !== "pending_payment" ? { hint: t("cancelHint") } : {}),
      danger: true,
      confirm: withLabels({
        verb: t("cancelVerb"),
        target: o.orderNo,
        consequence: t("cancelConsequence"),
        onConfirm: () => handleCancel(o),
      }),
    },
  ];

  return (
    <PageSection
      icon="lightning"
      level={2}
      title={t("title")}
      description={t("description")}
    >
      {error ? <Banner tone="danger" title={error} /> : null}

      {/* 服务卡片栅格(与订阅 hub 卡同构,3/行) */}
      {packs.length > 0 ? (
        <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {packs.map((p) => (
            <AddonPackCard
              key={p.packCode}
              pack={p}
              pendingOrderNo={pendingOrderFor(p.packCode)}
              busy={busy}
              onBuy={(pack) => void handleBuy(pack)}
              onContinue={goPay}
              formatMoney={formatMoney}
            />
          ))}
        </div>
      ) : loading ? null : (
        <EmptyState title={t("packsEmpty")} />
      )}

      {orders.length > 0 ? (
        <DataTable<ConsoleAddonOrder>
          columns={orderColumns}
          rows={orders}
          rowKey={(o) => o.orderNo}
          loading={loading}
          indexStart={1}
          rowActions={(o) => (
            <span className="inline-flex items-center justify-center gap-xs">
              {o.status === "pending_payment" && !o.paymentDeclared ? (
                <Button size="sm" onClick={() => goPay(o.orderNo)}>
                  {t("continuePay")}
                </Button>
              ) : null}
              <ActionMenu label={t("orderMenu")} items={orderMenuItems(o)} />
            </span>
          )}
          empty={<EmptyState title={t("ordersEmpty")} />}
        />
      ) : null}
    </PageSection>
  );
}
