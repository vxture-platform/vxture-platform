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
 *
 * Online single/merged applications use the same reviewed receipt lifecycle.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { useRouter } from "@/lib/i18n/navigation";
import {
  ActionMenu,
  Banner,
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
  fetchBillingSummary,
  fetchBills,
  fetchCredits,
  fetchInvoiceReceipts,
  type ConsoleBill,
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
import { buildTicketComposeHref } from "@/lib/ticket-compose";

import { PageSection, SectionBody, SignalList } from "@/layout/shell";
import { AddonPacksSection } from "./components/AddonPacksSection";
import { ADDON_SECTION_ID } from "./addon-routes";
import { useDateFormat } from "@/lib/use-date-format";
import { InvoiceApplicationDialog } from "./components/InvoiceApplicationDialog";
import { OrdersSection } from "./components/OrdersSection";

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
 * 是假的。`applying` / `approved` 归中间那一档。
 * `rejected` / `voided` 不在这张表里——它们已被 `receiptByBill` 滤掉,账单因此回到
 * 「未开票」。
 *
 * Applying and approved receipts remain pending until an operator records the
 * actual issuance; this derived phase does not replace the receipt's status.
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
  const { fmtDate, fmtTime, fmtDateTime } = useDateFormat();

  const t = useTranslations("billingPage");
  /* 求助入口的词在 `tickets.jump.*`(订单 / 账单 / 订阅三处同一族)。 */
  const tJump = useTranslations("tickets.jump");
  const tableLabels = useTableLabels();
  const router = useRouter();
  const locale = useLocale();
  const appLocale = locale as Locale;
  const { session } = useConsoleSession();
  const canManageInvoices = hasCapability(
    session.capabilities,
    "tenant.invoice.manage",
  );
  /* 加油包购买是**付款**权限,不是发票权限——板块从配额页迁来时要把它原样带过来。
     初稿我在这里图省事复用了 canManageInvoices,那等于悄悄换掉一道权限门:
     能开票的人未必该能下单花钱。 */
  const canPurchaseAddons = hasCapability(
    session.capabilities,
    "tenant.payment.manage",
  );

  const [summary, setSummary] = useState<ConsoleBillingSummary | null>(null);
  const [bills, setBills] = useState<ConsoleBill[]>([]);
  const [credits, setCredits] = useState<{
    balance: string;
    currency: string;
  } | null>(null);
  const [receipts, setReceipts] = useState<ConsoleInvoiceReceipt[]>([]);
  const [billsTotal, setBillsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [billsLoading, setBillsLoading] = useState(true);
  /* 读失败显影(批 0b):四路读全是 strict,任一失败置 loadFailed——指标画「—」、
   * 账单表画「读取失败」,不再把回落的 null / [] 画成「0 张待付、¥0 累计实收」。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedBills, setSelectedBills] = useState<ConsoleBill[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [applicationBills, setApplicationBills] = useState<
    ConsoleBill[] | null
  >(null);
  useEffect(() => {
    setSelectedBills([]);
    setApplicationBills(null);
    setSelectionError(null);
  }, [session.tenant?.id]);
  const eligible = (bill: ConsoleBill) =>
    bill.billStatus === "paid" &&
    Number(bill.payableAmount) > 0 &&
    !bill.invoiceStatus;

  // The ledger supplements bill status and downloads. The application dialog
  // loads address and verification details; the BFF enforces write eligibility.
  const reloadReceipts = useCallback(async () => {
    setReceipts(await fetchInvoiceReceipts());
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setPage(1);
    Promise.all([fetchBillingSummary(), fetchCredits(), reloadReceipts()])
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
  }, [session.tenant?.id, reloadReceipts, reloadKey]);

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
      for (const bill of r.bills ?? [{ id: r.billId }])
        if (!map.has(bill.id)) map.set(bill.id, r);
    }
    return map;
  }, [receipts]);

  /** 账单 → 发票三态。未开票 = 没有活跃申请（驳回/作废已在上面滤掉）。 */
  const invoicePhase = useCallback(
    (b: ConsoleBill): InvoicePhase => {
      const receipt = receiptByBill.get(b.id);
      const status = b.invoiceStatus ?? receipt?.invoiceStatus;
      return status
        ? (INVOICE_PHASE_BY_STATUS[status] ?? "processing")
        : "none";
    },
    [receiptByBill],
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
          description={fmtDateTime(b.createdAt)}
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
    return [
      {
        id: "apply-invoice",
        label: t("invoicing.applyAction"),
        disabled: !canManageInvoices || !eligible(b),
        hint: !eligible(b) ? t("invoicing.application.eligibility") : undefined,
        onSelect: () => setApplicationBills([b]),
      },
      {
        // Issued files remain available alongside application actions.
        id: "download-invoice",
        label: t("invoicing.records.download"),
        disabled: !(b.invoiceFileUrl ?? receipt?.invoiceFileUrl),
        onSelect: () => {
          const url = b.invoiceFileUrl ?? receipt?.invoiceFileUrl;
          if (url) window.open(url, "_blank", "noreferrer");
        },
      },
      /* 「就这张账单求助」(owner 2026-09-29 第 5 条裁决):**只跳转**。带上账单
         可视码去 /tickets,提单表单全 console 只有那一个。 */
      {
        id: "help",
        label: tJump("bill"),
        onSelect: () =>
          router.push(buildTicketComposeHref({ type: "bill", code: b.billNo })),
      },
    ];
  };

  return (
    <ViewLayout>
      {applicationBills && canManageInvoices ? (
        <InvoiceApplicationDialog
          bills={applicationBills}
          onClose={() => setApplicationBills(null)}
          onApplied={() => {
            setApplicationBills(null);
            setSelectedBills([]);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : null}
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
          canManageInvoices ? (
            <span className="flex items-center gap-sm">
              <Button
                size="md"
                variant="outline"
                disabled={
                  !selectedBills.length ||
                  selectedBills.length > 50 ||
                  loadFailed ||
                  billsLoading
                }
                onClick={() => setApplicationBills(selectedBills)}
              >
                <Icon name="receipt" size="xs" fallback="placeholder" />
                <span>
                  {t("invoicing.mergeAction")} ({selectedBills.length})
                </span>
              </Button>
              {selectedBills.length ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedBills([])}
                >
                  {t("invoicing.application.clear")}
                </Button>
              ) : null}
            </span>
          ) : undefined
        }
      >
        <Banner
          tone="info"
          title={t("invoicing.application.rules")}
          description={t("invoicing.application.eligibility")}
        />
        {selectionError ? (
          <Banner tone="warning" title={selectionError} />
        ) : null}
        {selectedBills.length ? (
          <p className="text-body-sm">
            {t("invoicing.application.selected", {
              count: selectedBills.length,
            })}
            : {selectedBills.map((b) => b.billNo).join("、")}
          </p>
        ) : null}
        <DataTable<ConsoleBill>
          labels={tableLabels}
          columns={billColumns}
          rows={bills}
          rowKey={(b) => b.id}
          loading={loading || billsLoading}
          indexStart={(page - 1) * BILLS_PAGE_SIZE + 1}
          isRowSelectable={(bill) =>
            canManageInvoices &&
            eligible(bill) &&
            (!selectedBills.length ||
              selectedBills[0]?.currency === bill.currency)
          }
          {...(canManageInvoices
            ? {
                selectedKeys: selectedBills.map((b) => b.id),
                onSelectionChange: (keys: readonly string[]) => {
                  const current = new Map(
                    [...selectedBills, ...bills].map((b) => [b.id, b]),
                  );
                  const candidates = keys
                    .map((id) => current.get(id))
                    .filter((b): b is ConsoleBill => !!b);
                  if (
                    candidates.some((b) => !eligible(b)) ||
                    candidates.length > 50 ||
                    new Set(candidates.map((b) => b.currency)).size > 1
                  ) {
                    setSelectionError(
                      t("invoicing.application.selectionInvalid"),
                    );
                    return;
                  }
                  setSelectionError(null);
                  setSelectedBills(candidates);
                },
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

      {/* ③ 加油包与扩展包(自助购买闭环;2026-09-08 从配额页迁来)。
          放在两张台账之后:来费用中心的人多半是来看账的,买的入口不该把账挤下去。
          加油包真实的发现路径是**配额页发现额度告急 → 去加购**,那边留了直达锚点
          的入口,所以这里靠后不影响找得到。 */}
      <AddonPacksSection
        id={ADDON_SECTION_ID}
        onSettledRefresh={() => setReloadKey((k) => k + 1)}
        formatMoney={money}
        canPurchase={canPurchaseAddons}
      />

      {/* ④ 收款与计费口径 */}
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
