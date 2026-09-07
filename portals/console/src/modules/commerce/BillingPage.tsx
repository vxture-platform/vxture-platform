"use client";

/**
 * BillingPage.tsx — 费用中心（product_331 重构；2026-09-06 归集订单、更名）。
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
 *
 * **2026-09-06 owner 裁定**:订单从「产品订阅」迁进来,页面随之更名「账单管理」→
 * 「费用中心」——装了订单+账单+发票之后,「账单」只是其中一块,名字太窄。钱这条链
 * 现在完整地落在一页:下单(OrdersSection)→ 出账(账单记录)→ 付款 → 开票。
 * 发票记录与开票抬头是**台账**,降为二级页 `/billing/invoices`;「申请发票」是账单行
 * 上的**动作**,留在本页(动作要发生在对象所在的那一页)。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { useRouter } from "@/lib/i18n/navigation";
import {
  ActionMenu,
  Button,
  DataTable,
  EmptyState,
  Icon,
  MetricGrid,
  StatusBadge,
  TableTitleCell,
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
  fetchTenantVerification,
  fetchInvoiceReceipts,
  type ConsoleBill,
  type ConsoleBillingAddress,
  type ConsoleBillingSummary,
  type ConsoleInvoiceReceipt,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { hasCapability } from "@/features/permissions/can";
import {
  LoadFailedBanner,
  LoadFailedEmpty,
} from "@/components/load/LoadFailed";
import { PlannedBadge } from "@/components/planned";

import { PageSection, SectionBody, SignalList } from "@/layout/shell";
import { fmtDate, fmtTime } from "./components/hubModel";
import { OrdersSection } from "./components/OrdersSection";
import { InvoiceSections } from "./components/InvoiceSections";

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

/**
 * 发票列的三态（owner 2026-09-07）。库里 `invoice_status` 有六值，但客户在账单表上
 * 要回答的只有一个问题:这张账单的票办到哪一步了。
 *
 * 为什么不压成两值:「已开票」是对税务凭证的事实陈述,票还没开出来就写「已开票」
 * 是假的。`applying` / `approved` 归「开票中」。
 * `rejected` / `voided` 不在这张表里——它们已被 `receiptByBill` 滤掉,账单因此回到
 * 「未开票」,可以重新申请。
 */
type InvoicePhase = "none" | "processing" | "issued";

const INVOICE_PHASE_BY_STATUS: Record<string, InvoicePhase> = {
  applying: "processing",
  approved: "processing",
  issued: "issued",
  sent: "issued",
};

const INVOICE_PHASE_TONES: Record<InvoicePhase, StatusBadgeTone> = {
  none: "neutral",
  processing: "info",
  issued: "success",
};

export function BillingPage() {
  const t = useTranslations("billingPage");
  const tableLabels = useTableLabels();
  const router = useRouter();
  const locale = useLocale();
  const appLocale = locale as Locale;
  const { session } = useConsoleSession();
  const canManageInvoices = hasCapability(
    session.capabilities,
    "tenant.invoice.manage",
  );

  const [summary, setSummary] = useState<ConsoleBillingSummary | null>(null);
  const [bills, setBills] = useState<ConsoleBill[]>([]);
  const [credits, setCredits] = useState<{
    balance: string;
    currency: string;
  } | null>(null);
  const [receipts, setReceipts] = useState<ConsoleInvoiceReceipt[]>([]);
  const [addresses, setAddresses] = useState<ConsoleBillingAddress[]>([]);
  const [billsTotal, setBillsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [billsLoading, setBillsLoading] = useState(true);
  /* 读失败显影(批 0b):四路读全是 strict,任一失败置 loadFailed——指标画「—」、
   * 账单表画「读取失败」,不再把回落的 null / [] 画成「0 张待付、¥0 累计实收」。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [applyBill, setApplyBill] = useState<ConsoleBill | null>(null);
  /* 勾选（合并开票的候选集）。表是服务端分页的,勾选只在本页内有效——翻页即清空:
   * 跨页累积会让「合并开票」把用户当下看不见的账单也开进一张票里。 */
  const [selectedBillIds, setSelectedBillIds] = useState<readonly string[]>([]);

  /**
   * 开票的认证门(owner 2026-09-06):简易企业实名认证可订阅、不可开票。这里只为
   * **提前告知**——真门在 console-bff。故单独一路读、失败不显影也不锁页面:读不到
   * 认证态就当不挡(null),让后端去拒,而不是因为一次读失败把开票入口关掉。
   */
  const [invoiceBlockedBy, setInvoiceBlockedBy] = useState<
    "lite" | "none" | null
  >(null);

  const reloadInvoicing = useCallback(async () => {
    const [receiptRows, addressRows] = await Promise.all([
      fetchInvoiceReceipts(),
      fetchBillingAddresses(),
    ]);
    setReceipts(receiptRows);
    setAddresses(addressRows);
  }, []);

  useEffect(() => {
    let active = true;
    fetchTenantVerification()
      .then((s) => {
        if (!active) return;
        setInvoiceBlockedBy(
          s.canIssueInvoice ? null : s.level === "lite" ? "lite" : "none",
        );
      })
      .catch(() => {
        if (active) setInvoiceBlockedBy(null);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setPage(1);
    Promise.all([fetchBillingSummary(), fetchCredits(), reloadInvoicing()])
      .then(([sum, creditRecord]) => {
        if (!active) return;
        setSummary(sum);
        setCredits(creditRecord);
      })
      .catch(() => {
        if (!active) return;
        setSummary(null);
        setCredits(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadInvoicing, reloadKey]);

  /* 账单表服务端分页(批 3):翻页只取那一页,total 由库数——此前一次拉 100 条在
   * 页面里翻,第 101 张账单起看不到也没人说。 */
  useEffect(() => {
    let active = true;
    setBillsLoading(true);
    fetchBills(page, BILLS_PAGE_SIZE)
      .then((result) => {
        if (!active) return;
        setBills(result.items);
        setBillsTotal(result.total);
      })
      .catch(() => {
        if (!active) return;
        setBills([]);
        setBillsTotal(0);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setBillsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session.tenant?.id, reloadKey, page]);

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

  useEffect(() => {
    setSelectedBillIds([]);
  }, [page, reloadKey]);

  /** 账单 → 发票三态。未开票 = 没有活跃申请（驳回/作废已在上面滤掉）。 */
  const invoicePhase = useCallback(
    (b: ConsoleBill): InvoicePhase => {
      const receipt = receiptByBill.get(b.id);
      if (!receipt) return "none";
      return INVOICE_PHASE_BY_STATUS[receipt.invoiceStatus] ?? "processing";
    },
    [receiptByBill],
  );

  /**
   * 可开票 = 已结清 ∧ 非零 ∧ 未开票（owner 2026-09-07）。
   *
   * 非零是这次新加的门:¥0 账单没有可开的税额,不该出现在开票链路里（¥0 订单同样
   * 出账是既有口径,见文件头）。金额取 `payableAmount`——它是账单的应付面额,也是表上
   * 显示、发票上要开的那个数。
   *
   * 同一个判据供三处用:行操作的「申请发票」是否可点、哪些行可勾选、以及勾选后
   * 「合并开票」的候选集。三者必须同源,否则会出现「能勾但不能开」这种自相矛盾。
   */
  const canApplyInvoice = useCallback(
    (b: ConsoleBill) =>
      b.billStatus === "paid" &&
      Number.parseFloat(b.payableAmount || "0") > 0 &&
      invoicePhase(b) === "none",
    [invoicePhase],
  );

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
    // 没读到就是「—」:读失败时的 0 不是没有账单,是没有数据。
    return [
      {
        id: "unpaid",
        icon: "receipt",
        label: t("metrics.unpaid"),
        value: summary ? String(unpaid) : "—",
        ...(unpaid > 0 ? { tone: "warning" as const } : {}),
        trend: !summary
          ? ""
          : overdue > 0
            ? t("metrics.unpaidOverdue", { count: overdue })
            : t("metrics.unpaidNone"),
        ...(overdue > 0 ? { trendTone: "warning" as const } : {}),
      },
      {
        id: "paid-total",
        icon: "seal-check",
        label: t("metrics.paidTotal"),
        value: summary ? money(summary.paidTotal, currency) : "—",
        trend: summary
          ? t("metrics.paidTotalHint", { count: summary.paid })
          : "",
      },
      {
        id: "credits",
        icon: "wallet",
        label: t("metrics.credits"),
        value: credits ? money(credits.balance, credits.currency) : "—",
        trend: credits ? t("metrics.creditsHint") : "",
      },
    ];
  }, [summary, credits, t, money]);

  // ── 账单表(服务端分页) ───────────────────────────────────────────────────
  const pageCount = Math.max(1, Math.ceil(billsTotal / BILLS_PAGE_SIZE));

  /*
   * 列对齐 = 全站表格规范（owner 2026-09-07，规范全文在 DS 的 `DataTable` 文件头）。
   * DS 11.0.0 起这条规范由件**结构性**保证:默认值随位置——首列 `left`、其余
   * `center`，新表不必逐列写。下面几处 `align:"center"` 与默认同值、留着不碍事;
   * 真正偏离默认的只有金额列的 `numeric`。
   */
  const billColumns: DataTableColumn<ConsoleBill>[] = [
    {
      id: "billNo",
      header: t("table.colBillNo"),
      // 首列（标题列）局左 = DS 默认,不显式标 align。两行主副走 DS 的
      // TableTitleCell,不再手写 flex-col——字号/行高/截断由件统一给。
      cell: (b) => (
        <TableTitleCell
          title={<span className="font-mono">{b.billNo}</span>}
          description={`${fmtDate(b.createdAt)} ${fmtTime(b.createdAt)}`}
        />
      ),
    },
    {
      id: "cycle",
      header: t("table.colCycle"),
      align: "center",
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
      align: "center",
      width: "sm",
      cell: (b) =>
        b.billType && KNOWN_BILL_TYPES.has(b.billType)
          ? t(`type.${b.billType}`)
          : t("type.normal"),
    },
    {
      // 金额列走 DS 的 numeric 档:右对齐 + 右内边距 + tabular-nums,由件统一给。
      id: "amount",
      header: t("table.colAmount"),
      align: "money",
      cell: (b) => (
        <span className="flex flex-col">
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
      align: "center",
      cell: (b) =>
        b.paidAt ? (
          <span className="flex flex-col items-center tabular-nums">
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
        /*
         * 状态列只表状态;申请动作按表格规范归操作列(rowActions)。
         * 三态而非二态:见 INVOICE_PHASE_BY_STATUS 的注释——票没开出来不写「已开票」。
         * 库里那六个状态的细分（申请中 / 已受理 / 已寄送…）在 /billing/invoices 台账里
         * 逐条可查,本列不复述。
         */
        const phase = invoicePhase(b);
        return (
          <StatusBadge tone={INVOICE_PHASE_TONES[phase]}>
            {t(`invoicing.phase.${phase}`)}
          </StatusBadge>
        );
      },
    },
  ];

  // ── 账单行操作(表格规范:操作归 rowActions 单列)──────────────────────────
  const billActions = (b: ConsoleBill): ActionMenuItem[] => {
    const receipt = receiptByBill.get(b.id);
    const zeroAmount = Number.parseFloat(b.payableAmount || "0") <= 0;
    return [
      {
        id: "apply-invoice",
        label: t("invoicing.applyAction"),
        // 开票资格 = 已结清 ∧ 非零 ∧ 未开票(canApplyInvoice 同一判据)。
        // 不限来源(直接订阅付款/预付款扣费对账单同栈)。
        // 申请动作 = tenant.invoice.manage(与 BFF 守卫同码)。
        disabled: !canManageInvoices || !canApplyInvoice(b),
        ...(!canManageInvoices
          ? { hint: t("invoicing.applyHintNoPermission") }
          : b.billStatus !== "paid"
            ? { hint: t("invoicing.applyHintUnpaid") }
            : zeroAmount
              ? { hint: t("invoicing.applyHintZero") }
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
          <>
            <Button
              variant="outline"
              size="md"
              onClick={() => router.push("/billing/invoices")}
            >
              <Icon name="file-text" size="xs" fallback="placeholder" />
              <span>{t("viewInvoices")}</span>
            </Button>
            {/* 对账单导出无端点；保持意图可见、禁用不装样。 */}
            <span className="flex items-center gap-sm">
              <Button size="md" variant="outline" disabled>
                <Icon name="arrow-down" size="xs" fallback="placeholder" />
                <span>{t("exportStatement")}</span>
              </Button>
              <PlannedBadge />
            </span>
          </>
        }
      />

      {loadFailed ? (
        <LoadFailedBanner
          onRetry={() => setReloadKey((k) => k + 1)}
          retrying={loading}
        />
      ) : null}

      <MetricGrid
        items={metrics}
        columns={3}
        loading={loading}
        aria-label={t("metrics.groupLabel")}
      />

      {/* ① 我的订单(owner 2026-09-06:订单是钱这条链的第一环,从产品订阅迁来) */}
      <OrdersSection />

      {/* ② 账单记录 */}
      <PageSection
        icon="receipt"
        level={2}
        title={t("table.title")}
        description={t("table.description")}
        action={
          /* 合并开票:一张发票覆盖多张账单。库里还表达不了——invoice_receipts.bill_id
           * 是 NOT NULL 单值外键,一票一单;要做得先加关联表并改 admin 的审核/开具侧。
           * 按本页 exportStatement 的既有做法:意图可见、禁用不装样。
           * 与选择列同一个门:没有开票权限的角色不出这个动作。 */
          canManageInvoices ? (
            <span className="flex items-center gap-sm">
              <Button size="md" variant="outline" disabled>
                <Icon name="receipt" size="xs" fallback="placeholder" />
                <span>
                  {selectedBillIds.length > 0
                    ? t("invoicing.mergeActionCount", {
                        count: selectedBillIds.length,
                      })
                    : t("invoicing.mergeAction")}
                </span>
              </Button>
              <PlannedBadge />
            </span>
          ) : undefined
        }
      >
        <DataTable<ConsoleBill>
          labels={tableLabels}
          columns={billColumns}
          rows={bills}
          rowKey={(b) => b.id}
          loading={loading || billsLoading}
          indexStart={(page - 1) * BILLS_PAGE_SIZE + 1}
          /* 选择列只对能开票的人出现（DS:给了 selectedKeys 才有这一列）。没有
           * tenant.invoice.manage 的角色勾了也没有能做的事,给一列点不动的复选框
           * 比不给更糟。行级判据与「申请发票」同源,避免「勾得上却开不了」。 */
          {...(canManageInvoices
            ? {
                selectedKeys: selectedBillIds,
                onSelectionChange: setSelectedBillIds,
                isRowSelectable: canApplyInvoice,
              }
            : {})}
          rowActions={(b) => (
            <ActionMenu label={t("invoicing.rowMenu")} items={billActions(b)} />
          )}
          empty={
            loadFailed ? (
              <LoadFailedEmpty />
            ) : (
              <EmptyState title={t("table.empty")} />
            )
          }
          footer={
            <div className="flex w-full items-center justify-between gap-md text-body-sm text-muted-foreground">
              <span className="tabular-nums">
                {loadFailed ? "—" : t("table.total", { count: billsTotal })}
              </span>
              {pageCount > 1 ? (
                <span className="flex items-center gap-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1 || billsLoading}
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
                    disabled={page >= pageCount || billsLoading}
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

      {/* 申请发票弹窗:动作留在账单所在的这一页;发票记录与开票抬头两块台账
          在二级页 `/billing/invoices`(owner 2026-09-06) */}
      <InvoiceSections
        mode="apply"
        receipts={receipts}
        addresses={addresses}
        loading={loading}
        readOnly={!canManageInvoices}
        applyBill={applyBill}
        onApplyClose={() => setApplyBill(null)}
        onChanged={reloadInvoicing}
        money={money}
        invoiceBlockedBy={invoiceBlockedBy}
      />

      {/* ③ 收款与计费口径 */}
      <PageSection
        icon="seal-check"
        level={2}
        title={t("notes.title")}
        description={t("notes.description")}
      >
        <SectionBody>
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
        </SectionBody>
      </PageSection>
    </ViewLayout>
  );
}
