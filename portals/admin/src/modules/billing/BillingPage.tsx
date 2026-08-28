"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  BulkActionBar,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { type StatusTone } from "@vxture-platform/shared";
import {
  BILL_STATUS_TONE,
  INVOICE_STATUS_TONE,
} from "@/modules/shared/status-tone";
import {
  TIER_FILTER_OPTIONS,
  tierBadgeClass,
  tierFilterOf,
  type TierFilterValue,
} from "@/modules/shared/tier-level";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { IconName } from "@vxture/design-system";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { isListTruncated } from "@/lib/list-truncation";
import { fetchBillingRecords, syncOfflineInvoice } from "@/api/admin-bff";
import type {
  BillingBillStatus,
  BillingBillType,
  BillingInvoiceStatus,
  BillingRecord,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  canSyncOfflineInvoice,
  offlineInvoiceDisabledReason,
  OfflineInvoiceDialog,
} from "@/modules/billing/OfflineInvoiceDialog";
import {
  formatDate,
  formatNumber,
  typeLabel,
} from "@/modules/tenants/tenant-utils";

type BillStatusFilter = "all" | BillingBillStatus;
type InvoiceStatusFilter = "all" | BillingInvoiceStatus;
type BillTypeFilter = "all" | BillingBillType;
type TierFilter = "all" | TierFilterValue;
type BillingExceptionFilter =
  | "all"
  | "attention"
  | "overdue_followup"
  | "discounted"
  | "adjust"
  | "supplement"
  | "cancelled"
  | "invoice_exception";

function formatCurrency(
  value: number,
  currency: string,
  maximumFractionDigits = 2,
) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    minimumFractionDigits: Math.min(2, maximumFractionDigits),
    maximumFractionDigits,
  }).format(value);
}

function billStatusLabel(status: BillingBillStatus) {
  if (status === "paying") return "支付中";
  if (status === "paid") return "已结清";
  if (status === "partial") return "部分收款";
  if (status === "cancelled") return "已作废";
  if (status === "overdue") return "逾期";
  return "待收款";
}

function billStatusIcon(status: BillingBillStatus): IconName {
  if (status === "paid") return "check";
  if (status === "cancelled") return "x";
  if (status === "overdue") return "warning";
  return "clock";
}

function billTypeLabel(type: BillingBillType) {
  if (type === "adjust") return "调整单";
  if (type === "supplement") return "补录单";
  if (type === "prepaid") return "预付费";
  return "正常账单";
}

/**
 * 账单上的异常标。`tone` 直接给 DS 语气档，不再走 `vx-billing-exception-pill--*`
 * 那套色名——调整单与补录单原先分蓝、紫两色，DS 没有紫档，两者同归 `brand`：
 * 它们的区别由"调整单"/"补录单"这两个词说，不该靠记颜色。
 */
function billingExceptionTags(bill: BillingRecord) {
  const tags: Array<{
    key: string;
    label: string;
    tone: StatusTone;
    title?: string;
  }> = [];

  if (bill.billType === "adjust") {
    const title = bill.operationRemark ?? undefined;
    tags.push({
      key: "adjust",
      label: "调整单",
      tone: "brand",
      ...(title ? { title } : {}),
    });
  }
  if (bill.billType === "supplement") {
    const title = bill.operationRemark ?? undefined;
    tags.push({
      key: "supplement",
      label: "补录单",
      tone: "brand",
      ...(title ? { title } : {}),
    });
  }
  if (bill.discountAmount > 0) {
    tags.push({
      key: "discounted",
      label: "已减免",
      tone: "warning",
      title: `减免 ${formatCurrency(bill.discountAmount, bill.currency)}`,
    });
  }
  if (bill.billStatus === "overdue") {
    tags.push({
      key: "overdue_followup",
      label: bill.operationRemark ? "逾期跟进" : "逾期待跟进",
      tone: "danger",
      title: bill.operationRemark ?? "当前账单已逾期，尚未登记跟进原因。",
    });
  }
  if (bill.billStatus === "cancelled") {
    const title = bill.operationRemark ?? undefined;
    tags.push({
      key: "cancelled",
      label: "已作废",
      tone: "neutral",
      ...(title ? { title } : {}),
    });
  }
  if (bill.invoiceStatus === "red" || bill.invoiceStatus === "rejected") {
    const title = bill.invoiceNo ?? undefined;
    tags.push({
      key: "invoice_exception",
      label: bill.invoiceStatus === "red" ? "发票红冲" : "发票驳回",
      tone: "danger",
      ...(title ? { title } : {}),
    });
  }

  return tags;
}

function hasBillingException(bill: BillingRecord) {
  return billingExceptionTags(bill).length > 0;
}

function matchesBillingExceptionFilter(
  bill: BillingRecord,
  filter: BillingExceptionFilter,
) {
  if (filter === "all") return true;
  if (filter === "attention") return hasBillingException(bill);
  if (filter === "overdue_followup") return bill.billStatus === "overdue";
  if (filter === "discounted") return bill.discountAmount > 0;
  if (filter === "adjust") return bill.billType === "adjust";
  if (filter === "supplement") return bill.billType === "supplement";
  if (filter === "cancelled") return bill.billStatus === "cancelled";
  return bill.invoiceStatus === "red" || bill.invoiceStatus === "rejected";
}

function cycleLabel(cycle: string) {
  if (cycle === "yearly") return "年度";
  if (cycle === "monthly") return "月度";
  if (cycle === "once") return "一次性";
  return cycle || "未设置";
}

/* 收 `t` 往下传：搜索文本里含状态文案，那些现在从词条取。 */
function billingSearchText(
  record: BillingRecord,
  t: ReturnType<typeof useTranslations>,
) {
  return [
    record.id,
    record.billNo,
    record.orderNo,
    record.invoiceNo,
    record.tenantCode,
    record.tenantName,
    record.region,
    record.industry,
    record.servicePlanName,
    record.tierName,
    record.operatorName,
    record.operationRemark,
    billTypeLabel(record.billType),
    billStatusLabel(record.billStatus),
    t(`status.invoice.${record.invoiceStatus}`),
    record.billStatus,
    record.invoiceStatus,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function billingCsvColumns(
  locale: string,
  t: ReturnType<typeof useTranslations>,
): CsvColumn<BillingRecord>[] {
  return [
    { label: "账单编号", value: (b) => b.billNo },
    { label: "订单编号", value: (b) => b.orderNo },
    { label: "租户编码", value: (b) => b.tenantCode },
    { label: "租户名称", value: (b) => b.tenantName },
    { label: "套餐", value: (b) => b.tierName ?? "" },
    { label: "账单类型", value: (b) => billTypeLabel(b.billType) },
    { label: "计费周期", value: (b) => cycleLabel(b.billCycle) },
    { label: "周期起", value: (b) => formatDate(b.cycleStartDate, locale) },
    { label: "周期止", value: (b) => formatDate(b.cycleEndDate, locale) },
    { label: "币种", value: (b) => b.currency },
    { label: "应收金额", value: (b) => b.payableAmount },
    { label: "原价金额", value: (b) => b.totalAmount },
    { label: "减免金额", value: (b) => b.discountAmount },
    { label: "已收金额", value: (b) => b.paidAmount },
    { label: "已开票金额", value: (b) => b.invoicedAmount },
    { label: "收款状态", value: (b) => billStatusLabel(b.billStatus) },
    { label: "发票状态", value: (b) => t(`status.invoice.${b.invoiceStatus}`) },
    { label: "发票号", value: (b) => b.invoiceNo ?? "" },
    { label: "经办人", value: (b) => b.operatorName },
  ];
}

function BillingActionsMenu({
  bill,
  onSyncInvoice,
}: {
  bill: BillingRecord;
  onSyncInvoice: (bill: BillingRecord) => void;
}) {
  const tShared = useTranslations();
  const router = useRouter();
  const invoiceDisabledReason = offlineInvoiceDisabledReason(bill) ?? undefined;

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${bill.billNo} 账单操作`}
        items={[
          {
            id: "details",
            label: "账单详情",
            icon: "arrow-right",
            onSelect: () =>
              router.push(`/billing/${encodeURIComponent(bill.billNo)}`),
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(bill.tenantCode)}`),
          },
          {
            id: "subscription",
            label: "查看订阅",
            icon: "star",
            disabled: !bill.subscriptionId,
            onSelect: () => {
              if (!bill.subscriptionId) return;
              router.push(
                `/subscriptions/${encodeURIComponent(bill.orderNo ?? bill.subscriptionId ?? "")}`,
              );
            },
          },
          {
            id: "order",
            label: "查看订单",
            icon: "table",
            disabled: !bill.subscriptionId,
            onSelect: () => {
              if (!bill.subscriptionId) return;
              router.push(
                `/orders/${encodeURIComponent(bill.orderNo ?? bill.subscriptionId ?? "")}`,
              );
            },
          },
          {
            id: "invoice",
            label: "登记发票",
            icon: "key",
            disabled: !canSyncOfflineInvoice(bill),
            ...(invoiceDisabledReason ? { title: invoiceDisabledReason } : {}),
            onSelect: () => onSyncInvoice(bill),
          },
        ]}
      />
    </div>
  );
}

/**
 * 状态标（账单态、发票态、异常标）走 `StatusBadge`，语气由 `status-tone.ts` 给。
 *
 * 套餐等级仍是 pill：等级是**序**不是语气（free < pro < enterprise），DS 的六档
 * 语气里没有"高一级"这回事，套上去只会把它读成状态。它归 `--level-1..5` 阶梯，
 * 与缺色（starter / business）一起另算。
 */
function useBillingColumns(): DataTableColumn<BillingRecord>[] {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  return [
    {
      id: "bill",
      header: "账单",
      cell: (bill) => (
        <TableTitleCell
          title={bill.billNo}
          description={`${cycleLabel(bill.billCycle)} · ${formatDate(bill.cycleStartDate, locale)} - ${formatDate(bill.cycleEndDate, locale)}`}
          onTitleClick={() =>
            router.push(`/billing/${encodeURIComponent(bill.billNo)}`)
          }
        />
      ),
    },
    {
      id: "tenant",
      header: "租户",
      cell: (bill) => (
        <TableTitleCell
          icon={bill.tenantType === "company" ? "buildings" : "user"}
          title={bill.tenantName}
          description={`${bill.tenantCode} · ${typeLabel(bill.tenantType)}`}
        />
      ),
    },
    {
      id: "plan",
      header: "订阅套餐",
      cell: (bill) => (
        <TableTitleCell
          title={
            <Badge className={tierBadgeClass(bill.tierName)}>
              {bill.tierName ?? "未关联"}
            </Badge>
          }
          description={bill.servicePlanName ?? bill.orderNo ?? "未关联订阅"}
        />
      ),
    },
    {
      id: "amount",
      header: "金额",
      align: "right",
      cell: (bill) => (
        <TableTitleCell
          title={formatCurrency(bill.payableAmount, bill.currency)}
          description={
            bill.discountAmount > 0
              ? `原价 ${formatCurrency(bill.totalAmount, bill.currency)} · 减免 ${formatCurrency(bill.discountAmount, bill.currency)}`
              : `原价 ${formatCurrency(bill.totalAmount, bill.currency)}`
          }
        />
      ),
    },
    {
      id: "exception",
      header: "处理",
      align: "center",
      cell: (bill) => {
        const tags = billingExceptionTags(bill);
        return (
          <TableTitleCell
            title={
              tags.length ? (
                <span className="inline-flex flex-wrap gap-2xs">
                  {tags.map((tag) => (
                    <StatusBadge
                      key={tag.key}
                      tone={tag.tone}
                      {...(tag.title ? { title: tag.title } : {})}
                    >
                      {tag.label}
                    </StatusBadge>
                  ))}
                </span>
              ) : (
                "-"
              )
            }
            {...(bill.operationRemark
              ? { description: bill.operationRemark }
              : {})}
          />
        );
      },
    },
    {
      id: "payment",
      header: "收款",
      align: "center",
      cell: (bill) => (
        <TableTitleCell
          title={
            <StatusBadge
              tone={BILL_STATUS_TONE[bill.billStatus]}
              icon={billStatusIcon(bill.billStatus)}
            >
              {billStatusLabel(bill.billStatus)}
            </StatusBadge>
          }
          description={`已收 ${formatCurrency(bill.paidAmount, bill.currency)}`}
        />
      ),
    },
    {
      id: "invoice",
      header: "发票",
      align: "center",
      cell: (bill) => (
        <TableTitleCell
          title={
            <StatusBadge tone={INVOICE_STATUS_TONE[bill.invoiceStatus]}>
              {t(`status.invoice.${bill.invoiceStatus}`)}
            </StatusBadge>
          }
          description={
            bill.invoiceNo ??
            `已登记 ${formatCurrency(bill.invoicedAmount, bill.currency)}`
          }
        />
      ),
    },
  ];
}

export function BillingPage() {
  const t = useTranslations();
  const locale = useLocale();
  const tShared = useTranslations();
  const [bills, setBills] = useState<BillingRecord[]>([]);
  const [billsTruncated, setBillsTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [billStatusFilter, setBillStatusFilter] =
    useState<BillStatusFilter>("all");
  const [invoiceStatusFilter, setInvoiceStatusFilter] =
    useState<InvoiceStatusFilter>("all");
  const [billTypeFilter, setBillTypeFilter] = useState<BillTypeFilter>("all");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [exceptionFilter, setExceptionFilter] =
    useState<BillingExceptionFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invoiceTarget, setInvoiceTarget] = useState<BillingRecord | null>(
    null,
  );
  const [submittingInvoice, setSubmittingInvoice] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<string | null>(
    null,
  );
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    fetchBillingRecords()
      .then((records) => {
        if (active) {
          setBills(records);
          setBillsTruncated(isListTruncated(records));
        }
      })
      .catch((error) => {
        if (active) {
          setBills([]);
          setBillsTruncated(false);
          setLoadError(
            error instanceof Error ? error.message : "账单数据读取失败",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const billingColumns = useBillingColumns();

  const filteredBills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return bills.filter((bill) => {
      if (billStatusFilter !== "all" && bill.billStatus !== billStatusFilter)
        return false;
      if (
        invoiceStatusFilter !== "all" &&
        bill.invoiceStatus !== invoiceStatusFilter
      )
        return false;
      if (billTypeFilter !== "all" && bill.billType !== billTypeFilter)
        return false;
      if (tierFilter !== "all" && tierFilterOf(bill.tierName) !== tierFilter)
        return false;
      if (!matchesBillingExceptionFilter(bill, exceptionFilter)) return false;
      if (
        normalizedQuery &&
        !billingSearchText(bill, t).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [
    /* `t` 进依赖：过滤要读状态文案（`billingSearchText` / `paymentSearchText`
       内部用它查词条）。next-intl 的 translator 按 (命名空间, messages, locale)
       记忆化，只在切语言时换身份，所以这不会让 memo 每次渲染失效，反而保证
       切语言时搜索匹配的是新语言的文案。这里没有 effect 依赖它。 */
    billStatusFilter,
    billTypeFilter,
    bills,
    exceptionFilter,
    invoiceStatusFilter,
    query,
    tierFilter,
    t,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredBills.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleBills = filteredBills.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const receivableAmount = bills.reduce(
    (sum, item) => sum + item.payableAmount,
    0,
  );
  const paidAmount = bills.reduce((sum, item) => sum + item.paidAmount, 0);
  const pendingCount = bills.filter(
    (item) =>
      item.billStatus === "unpaid" ||
      item.billStatus === "paying" ||
      item.billStatus === "partial" ||
      item.billStatus === "overdue",
  ).length;
  const invoicePendingCount = bills.filter(
    (item) =>
      item.invoiceStatus === "none" ||
      item.invoiceStatus === "applying" ||
      item.invoiceStatus === "auditing",
  ).length;
  const invoicedAmount = bills.reduce(
    (sum, item) => sum + item.invoicedAmount,
    0,
  );
  const exceptionCount = bills.filter(hasBillingException).length;
  const discountedAmount = bills.reduce(
    (sum, item) => sum + item.discountAmount,
    0,
  );
  const exceptionBillCount = bills.filter(
    (item) => item.billType === "adjust" || item.billType === "supplement",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [
    billStatusFilter,
    billTypeFilter,
    exceptionFilter,
    invoiceStatusFilter,
    pageSize,
    query,
    tierFilter,
  ]);

  function handleReset() {
    setQuery("");
    setBillStatusFilter("all");
    setInvoiceStatusFilter("all");
    setBillTypeFilter("all");
    setTierFilter("all");
    setExceptionFilter("all");
  }

  function handleExportSelected() {
    const rows = filteredBills.filter((bill) => selectedBillIds.has(bill.id));
    exportRowsToCsv(
      "billing-selected-export",
      billingCsvColumns(locale, t),
      rows,
    );
  }

  function clearBillSelection() {
    setSelectedBillIds(new Set());
  }

  function requestInvoiceSync(bill: BillingRecord) {
    setOperationError(null);
    setOperationFeedback(null);
    setInvoiceTarget(bill);
  }

  async function handleSyncOfflineInvoice(
    payload: Parameters<typeof syncOfflineInvoice>[1],
  ) {
    if (!invoiceTarget) return;

    setSubmittingInvoice(true);
    setOperationError(null);

    try {
      await syncOfflineInvoice(invoiceTarget.id, payload);
      const records = await fetchBillingRecords();
      setBills(records);
      setBillsTruncated(isListTruncated(records));
      setOperationFeedback("线下发票已完成同步登记。");
      setInvoiceTarget(null);
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "线下发票登记失败，请稍后重试。",
      );
    } finally {
      setSubmittingInvoice(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="w-full vx-billing-page"
        header={
          <PageHeader
            icon="key"
            eyebrow="财务结算"
            title="账单中心"
            description="运营侧查看租户账单、收款进度和线下发票处理结果；当前仅支持人工同步登记，不调用在线开票接口。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="账单中心统计"
              items={[
                {
                  id: "total",
                  help: "当前筛选条件下的账单条数。",
                  icon: "key",
                  label: "账单总数",
                  value: formatNumber(bills.length),
                  tags: [
                    `筛选 ${formatNumber(filteredBills.length)}`,
                    `异常 ${formatNumber(exceptionCount)}`,
                  ],
                },
                {
                  id: "pending",
                  help: "未结清账单：未支付、支付中、部分支付、已逾期。",
                  icon: "clock",
                  label: tShared("status.generic.awaitingPayment"),
                  value: formatNumber(pendingCount),
                  tags: [
                    `逾期 ${formatNumber(bills.filter((item) => item.billStatus === "overdue").length)}`,
                  ],
                  tone: pendingCount ? "warning" : "success",
                },
                {
                  id: "receivable",
                  help: "全部账单应收金额合计。",
                  icon: "chart-bar",
                  label: "应收金额",
                  value: formatCurrency(receivableAmount, "CNY"),
                  tags: [
                    `已收 ${formatCurrency(paidAmount, "CNY")}`,
                    `减免 ${formatCurrency(discountedAmount, "CNY")}`,
                  ],
                  tone: "success",
                },
                {
                  id: "invoiced",
                  help: "全部账单已开票金额合计，与应收的差额即待开票部分。",
                  icon: "table",
                  label: "开票进度",
                  value: formatCurrency(invoicedAmount, "CNY"),
                  tags: [
                    `待处理 ${formatNumber(invoicePendingCount)}`,
                    `调整 ${formatNumber(exceptionBillCount)}`,
                  ],
                  tone: invoicePendingCount ? "warning" : "success",
                },
              ]}
            />
            {operationFeedback ? (
              <div className="inline-flex w-fit items-center rounded-lg bg-success-muted px-sm py-xs text-body-sm text-success-text">
                {operationFeedback}
              </div>
            ) : null}
            {billsTruncated ? (
              <Banner
                tone="warning"
                title="当前账单列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标账单，请尝试缩小筛选范围（如按状态、类型等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            count={formatNumber(filteredBills.length)}
            aria-label="账单筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索账单、租户、订单、发票"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索账单"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton
                  variant={selectedBillIds.size > 0 ? "default" : "outline"}
                  icon="arrow-down"
                  onClick={handleExportSelected}
                  disabled={selectedBillIds.size === 0}
                >
                  {tShared("common.export")}
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={billStatusFilter}
                onChange={(event) =>
                  setBillStatusFilter(event.target.value as BillStatusFilter)
                }
                aria-label="账单状态"
              >
                <option value="all">全部账单</option>
                <option value="unpaid">
                  {tShared("status.generic.awaitingPayment")}
                </option>
                <option value="paying">
                  {tShared("status.generic.paying")}
                </option>
                <option value="partial">
                  {tShared("status.generic.partiallyPaid")}
                </option>
                <option value="paid">
                  {tShared("status.generic.settled")}
                </option>
                <option value="overdue">
                  {tShared("status.generic.overdue")}
                </option>
                <option value="cancelled">已取消</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={invoiceStatusFilter}
                onChange={(event) =>
                  setInvoiceStatusFilter(
                    event.target.value as InvoiceStatusFilter,
                  )
                }
                aria-label="发票状态"
              >
                <option value="all">全部发票</option>
                <option value="none">未开票</option>
                <option value="applying">申请中</option>
                <option value="auditing">审核中</option>
                <option value="issued">已开票</option>
                <option value="sending">寄送中</option>
                <option value="finished">
                  {tShared("status.generic.completed")}
                </option>
                <option value="rejected">
                  {tShared("status.generic.rejected")}
                </option>
                <option value="red">已红冲</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={billTypeFilter}
                onChange={(event) =>
                  setBillTypeFilter(event.target.value as BillTypeFilter)
                }
                aria-label="账单类型"
              >
                <option value="all">{tShared("filters.allKinds")}</option>
                <option value="normal">正常账单</option>
                <option value="adjust">调整单</option>
                <option value="supplement">补录单</option>
                <option value="prepaid">预付费</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={exceptionFilter}
                onChange={(event) =>
                  setExceptionFilter(
                    event.target.value as BillingExceptionFilter,
                  )
                }
                aria-label="处理类型"
              >
                <option value="all">全部处理</option>
                <option value="attention">需关注</option>
                <option value="overdue_followup">逾期跟进</option>
                <option value="discounted">应收减免</option>
                <option value="adjust">调整单</option>
                <option value="supplement">补录单</option>
                <option value="cancelled">
                  {tShared("status.generic.voided")}
                </option>
                <option value="invoice_exception">发票异常</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={tierFilter}
                onChange={(event) =>
                  setTierFilter(event.target.value as TierFilter)
                }
                aria-label="套餐版本"
              >
                <option value="all">全部套餐</option>
                {TIER_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            </>
          </FilterBar>
        }
        /* BulkActionBar 数据驱动：计数与"清除"由组件自己画，调用方只给动作清单。
         原先两者都要调用方手拼，于是每个列表页的计数文案与清除按钮各写一遍。 */
        bulkBar={
          selectedBillIds.size > 0 ? (
            <BulkActionBar
              count={selectedBillIds.size}
              actions={[
                {
                  id: "export",
                  label: tShared("common.exportSelected"),
                  icon: "table",
                  onSelect: handleExportSelected,
                },
              ]}
              onClear={clearBillSelection}
            />
          ) : null
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="账单清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}

            <DataTable
              columns={billingColumns}
              rows={visibleBills}
              rowKey={(bill) => bill.id}
              loading={loading}
              indexStart={(activePage - 1) * pageSize + 1}
              selectedKeys={[...selectedBillIds]}
              onSelectionChange={(keys) => setSelectedBillIds(new Set(keys))}
              rowActions={(bill) => (
                <BillingActionsMenu
                  bill={bill}
                  onSyncInvoice={requestInvoiceSync}
                />
              )}
              empty={
                <EmptyState
                  title={loadError ? "账单数据读取失败" : "没有匹配的账单"}
                  description={
                    loadError ?? "清空筛选条件后可查看全部账单记录。"
                  }
                  action={
                    <ActionButton
                      variant="outline"
                      icon="x"
                      onClick={handleReset}
                    >
                      {tShared("common.clearFilters")}
                    </ActionButton>
                  }
                />
              }
            />
          </section>
        }
        footer={
          <ListPagination
            currentPage={activePage}
            pageCount={pageCount}
            total={filteredBills.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />

      {invoiceTarget ? (
        <OfflineInvoiceDialog
          bill={invoiceTarget}
          busy={submittingInvoice}
          error={operationError}
          onCancel={() => {
            if (!submittingInvoice) setInvoiceTarget(null);
          }}
          onSubmit={handleSyncOfflineInvoice}
        />
      ) : null}
    </>
  );
}
