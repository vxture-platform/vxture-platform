"use client";

/**
 * BillingPage.tsx — 账单管理（product_331 重构）。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * 订阅制口径的简单实现（owner 2026-08-20：产品以订阅付费为主，预付费/扣费
 * 暂少，从简）：账单随订阅订单生成、线下对公收款人工核销、0 元订单同样出账。
 * 严格 DS 组合件拼装（同产品订阅页整改口径）：MetricGrid（columns 按本页
 * 指标数=3 铺满）+ PageSection 原生 icon prop + DataTable + SignalList，
 * 无自造样式层。中文为基准，zh/en 双份 i18n（billingPage 命名空间）。
 * 全页无 UUID：账单号 = bill_no 可视码。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionMenu,
  Button,
  DataTable,
  EmptyState,
  Icon,
  MetricGrid,
  StatusBadge,
  ViewHeader,
  ViewLayout,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  MetricGridItem,
  StatusBadgeTone,
} from "@vxture/design-system";
import { formatCurrency, type Locale } from "@vxture-platform/shared";
import {
  fetchBillingAddresses,
  fetchBillingSummary,
  fetchBills,
  fetchCredits,
  fetchInvoiceReceipts,
  type ConsoleBill,
  type ConsoleBillingAddress,
  type ConsoleBillingSummary,
  type ConsoleInvoiceReceipt,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { PlannedBadge } from "@/components/planned";
import { PageSection, SignalList } from "@/layout/shell";
import { fmtDate, fmtTime } from "./components/hubModel";
import {
  InvoiceSections,
  RECEIPT_STATUS_TONES,
} from "./components/InvoiceSections";

const BILLS_PAGE_SIZE = 10;

/** bill_status 六值域（52_billing.sql CHECK）→ 徽章语气。 */
const BILL_STATUS_TONES: Record<string, StatusBadgeTone> = {
  unpaid: "warning",
  paying: "info",
  partial: "info",
  paid: "success",
  overdue: "warning",
  cancelled: "neutral",
};

/** bill_type 值域（normal|one_off|adjustment|prepaid_statement）。 */
const KNOWN_BILL_TYPES = new Set([
  "normal",
  "one_off",
  "adjustment",
  "prepaid_statement",
]);

export function BillingPage() {
  const t = useTranslations("billingPage");
  const locale = useLocale();
  const appLocale = locale as Locale;
  const { session } = useConsoleSession();

  const [summary, setSummary] = useState<ConsoleBillingSummary | null>(null);
  const [bills, setBills] = useState<ConsoleBill[]>([]);
  const [credits, setCredits] = useState<{
    balance: string;
    currency: string;
  } | null>(null);
  const [receipts, setReceipts] = useState<ConsoleInvoiceReceipt[]>([]);
  const [addresses, setAddresses] = useState<ConsoleBillingAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [applyBill, setApplyBill] = useState<ConsoleBill | null>(null);

  const reloadInvoicing = useCallback(async () => {
    const [receiptRows, addressRows] = await Promise.all([
      fetchInvoiceReceipts(),
      fetchBillingAddresses(),
    ]);
    setReceipts(receiptRows);
    setAddresses(addressRows);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchBillingSummary(),
      fetchBills(),
      fetchCredits(),
      reloadInvoicing(),
    ])
      .then(([sum, rows, creditRecord]) => {
        setSummary(sum);
        setBills(rows);
        setCredits(creditRecord);
      })
      .finally(() => setLoading(false));
  }, [session.tenant?.id, reloadInvoicing]);

  // 账单 → 活跃开票申请(rejected/voided 之外均占位,防重复申请)
  const receiptByBill = useMemo(() => {
    const map = new Map<string, ConsoleInvoiceReceipt>();
    for (const r of receipts) {
      if (r.invoiceStatus === "rejected" || r.invoiceStatus === "voided")
        continue;
      if (!map.has(r.billId)) map.set(r.billId, r);
    }
    return map;
  }, [receipts]);

  const money = useCallback(
    (v: string, currency: string) =>
      formatCurrency(Number.parseFloat(v || "0"), appLocale, currency),
    [appLocale],
  );

  // ── 概览指标（本页业务 3 个指标 → columns=3 铺满，列数随业务不写死）──────
  const metrics = useMemo<MetricGridItem[]>(() => {
    const currency = summary?.currency ?? "CNY";
    const unpaid = summary?.unpaid ?? 0;
    const overdue = summary?.overdue ?? 0;
    return [
      {
        id: "unpaid",
        icon: "receipt",
        label: t("metrics.unpaid"),
        value: String(unpaid),
        ...(unpaid > 0 ? { tone: "warning" as const } : {}),
        trend:
          overdue > 0
            ? t("metrics.unpaidOverdue", { count: overdue })
            : t("metrics.unpaidNone"),
        ...(overdue > 0 ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "paid-total",
        icon: "seal-check",
        label: t("metrics.paidTotal"),
        value: money(summary?.paidTotal ?? "0", currency),
        trend: t("metrics.paidTotalHint", { count: summary?.paid ?? 0 }),
      },
      {
        id: "credits",
        icon: "wallet",
        label: t("metrics.credits"),
        value: money(credits?.balance ?? "0", credits?.currency ?? "CNY"),
        trend: t("metrics.creditsHint"),
      },
    ];
  }, [summary, credits, t, money]);

  // ── 账单表 ────────────────────────────────────────────────────────────────
  const pageCount = Math.max(1, Math.ceil(bills.length / BILLS_PAGE_SIZE));
  const pagedBills = useMemo(
    () => bills.slice((page - 1) * BILLS_PAGE_SIZE, page * BILLS_PAGE_SIZE),
    [bills, page],
  );

  const billColumns: DataTableColumn<ConsoleBill>[] = [
    {
      id: "billNo",
      header: t("table.colBillNo"),
      cell: (b) => (
        <span className="flex flex-col">
          <span className="font-mono text-label-md text-foreground">
            {b.billNo}
          </span>
          <span className="text-body-sm text-muted-foreground tabular-nums">
            {fmtDate(b.createdAt)} {fmtTime(b.createdAt)}
          </span>
        </span>
      ),
    },
    {
      id: "cycle",
      header: t("table.colCycle"),
      cell: (b) =>
        b.cycleStartDate && b.cycleEndDate ? (
          <span className="tabular-nums">
            {fmtDate(b.cycleStartDate)} ~ {fmtDate(b.cycleEndDate)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "type",
      header: t("table.colType"),
      width: "sm",
      cell: (b) =>
        b.billType && KNOWN_BILL_TYPES.has(b.billType)
          ? t(`type.${b.billType}`)
          : t("type.normal"),
    },
    {
      id: "amount",
      header: t("table.colAmount"),
      align: "right",
      cell: (b) => (
        <span className="flex flex-col items-end tabular-nums">
          <span className="font-semibold text-foreground">
            {money(b.payableAmount, b.currency)}
          </span>
          {Number.parseFloat(b.discountAmount) > 0 ? (
            <span className="text-body-sm text-muted-foreground">
              {t("table.discountOff", {
                amount: money(b.discountAmount, b.currency),
              })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "status",
      header: t("table.colStatus"),
      align: "center",
      cell: (b) => (
        <StatusBadge tone={BILL_STATUS_TONES[b.billStatus] ?? "neutral"}>
          {t(`status.${b.billStatus}`)}
        </StatusBadge>
      ),
    },
    {
      id: "paidAt",
      header: t("table.colPaidAt"),
      cell: (b) =>
        b.paidAt ? (
          <span className="flex flex-col tabular-nums">
            <span className="text-foreground">{fmtDate(b.paidAt)}</span>
            <span className="text-body-sm text-muted-foreground">
              {fmtTime(b.paidAt)}
            </span>
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "invoice",
      header: t("table.colInvoice"),
      align: "center",
      cell: (b) => {
        // 状态列只表状态;申请动作按表格规范归操作列(rowActions)
        const receipt = receiptByBill.get(b.id);
        if (!receipt) return "—";
        return (
          <StatusBadge
            tone={RECEIPT_STATUS_TONES[receipt.invoiceStatus] ?? "neutral"}
          >
            {t(`invoicing.status.${receipt.invoiceStatus}`)}
          </StatusBadge>
        );
      },
    },
  ];

  // ── 账单行操作(表格规范:操作归 rowActions 单列)──────────────────────────
  const billActions = (b: ConsoleBill): ActionMenuItem[] => {
    const receipt = receiptByBill.get(b.id);
    return [
      {
        id: "apply-invoice",
        label: t("invoicing.applyAction"),
        // 开票资格 = 已结清;不限来源(直接订阅付款/预付款扣费对账单同栈)
        disabled: b.billStatus !== "paid" || receipt !== undefined,
        ...(b.billStatus !== "paid"
          ? { hint: t("invoicing.applyHintUnpaid") }
          : receipt
            ? { hint: t("invoicing.applyHintApplied") }
            : {}),
        onSelect: () => setApplyBill(b),
      },
      {
        id: "download-invoice",
        label: t("invoicing.records.download"),
        disabled: !receipt?.invoiceFileUrl,
        onSelect: () => {
          if (receipt?.invoiceFileUrl)
            window.open(receipt.invoiceFileUrl, "_blank", "noreferrer");
        },
      },
    ];
  };

  return (
    <ViewLayout>
      <ViewHeader
        icon="receipt"
        title={t("title")}
        description={t("description")}
        action={
          /* 对账单导出无端点；保持意图可见、禁用不装样。 */
          <span className="flex items-center gap-sm">
            <Button size="md" variant="outline" disabled>
              <Icon name="arrow-down" size="xs" fallback="placeholder" />
              <span>{t("exportStatement")}</span>
            </Button>
            <PlannedBadge />
          </span>
        }
      />

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      {/* ① 账单记录 */}
      <PageSection
        icon="receipt"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
      >
        <DataTable<ConsoleBill>
          columns={billColumns}
          rows={pagedBills}
          rowKey={(b) => b.id}
          loading={loading}
          indexStart={(page - 1) * BILLS_PAGE_SIZE + 1}
          rowActions={(b) => (
            <ActionMenu label={t("invoicing.rowMenu")} items={billActions(b)} />
          )}
          empty={<EmptyState title={t("table.empty")} />}
          footer={
            <div className="flex w-full items-center justify-between gap-md text-body-sm text-muted-foreground">
              <span className="tabular-nums">
                {t("table.total", { count: bills.length })}
              </span>
              {pageCount > 1 ? (
                <span className="flex items-center gap-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t("table.prevPage")}
                  </Button>
                  <span className="tabular-nums">
                    {page} / {pageCount}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  >
                    {t("table.nextPage")}
                  </Button>
                </span>
              ) : null}
            </div>
          }
        />
      </PageSection>

      {/* ②③ 发票记录 + 开票抬头(owner 2026-08-21:归集账单管理,位于账单表
          下方、收款口径上方;两个开票来源同为已结清账单不分流) */}
      <InvoiceSections
        receipts={receipts}
        addresses={addresses}
        loading={loading}
        applyBill={applyBill}
        onApplyClose={() => setApplyBill(null)}
        onChanged={reloadInvoicing}
        money={money}
      />

      {/* ④ 收款与计费口径 */}
      <PageSection
        icon="seal-check"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SignalList
          items={[
            {
              title: t("notes.paymentTitle"),
              description: t("notes.paymentBody"),
            },
            {
              title: t("notes.billingTitle"),
              description: t("notes.billingBody"),
            },
          ]}
        />
      </PageSection>
    </ViewLayout>
  );
}
