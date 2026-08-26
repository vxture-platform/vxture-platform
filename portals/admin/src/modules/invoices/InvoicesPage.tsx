"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  BulkActionBar,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  ListCardGrid,
  ListPageTemplate,
  MetricGrid,
  MetricListCard,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { resolveStatusTone } from "@vxture-platform/shared";
import {
  BILL_STATUS_TONE,
  INVOICE_STATUS_TONE,
} from "@/modules/shared/status-tone";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { ActionMenuItem, IconName } from "@vxture/design-system";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { isListTruncated } from "@/lib/list-truncation";
import {
  fetchInvoiceLedgerRecords,
  submitBillingInvoiceReceiptAction,
} from "@/api/admin-bff";
import type {
  BillingInvoiceLedgerRecord,
  BillingInvoiceReceiptAction,
  BillingInvoiceStatus,
  BillingInvoiceTaxType,
  BillingInvoiceType,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  canRunInvoiceReceiptAction,
  InvoiceReceiptActionDialog,
  invoiceReceiptActionDisabledReason,
  invoiceReceiptActionLabel,
} from "@/modules/billing/InvoiceReceiptActionDialog";
import {
  formatDate,
  formatNumber,
  typeLabel,
} from "@/modules/tenants/tenant-utils";

type ViewMode = "list" | "cards";
type InvoiceStatusFilter =
  | "all"
  | BillingInvoiceStatus
  | "active"
  | "exception";
type InvoiceTypeFilter = "all" | BillingInvoiceType;
type InvoiceTaxFilter = "all" | BillingInvoiceTaxType;
type DeliveryFilter = "all" | "not_sent" | "sent" | "finished";

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

function invoiceStatusLabel(status: BillingInvoiceStatus) {
  if (status === "applying") return "申请中";
  if (status === "auditing") return "审核中";
  if (status === "issued") return "已开票";
  if (status === "sending") return "寄送中";
  if (status === "finished") return "已完成";
  if (status === "rejected") return "已驳回";
  if (status === "red") return "已红冲";
  return "未开票";
}

function invoiceTypeLabel(type: BillingInvoiceType) {
  if (type === "special_vat") return "增值税专票";
  if (type === "normal_vat") return "增值税普票";
  if (type === "electronic") return "电子发票";
  if (type === "paper") return "纸质发票";
  return "其他";
}

function taxTypeLabel(type: BillingInvoiceTaxType) {
  if (type === "enterprise") return "企业";
  if (type === "individual") return "个人";
  if (type === "government") return "政府/事业单位";
  return "其他";
}

function billTypeLabel(type: string) {
  if (type === "adjust") return "调整单";
  if (type === "supplement") return "补录单";
  if (type === "prepaid") return "预付费";
  return "正常账单";
}

function billStatusLabel(status: string) {
  if (status === "paid") return "已结清";
  if (status === "partial") return "部分收款";
  if (status === "paying") return "支付中";
  if (status === "cancelled") return "已作废";
  if (status === "overdue") return "逾期";
  return "待收款";
}

function invoiceStatusIcon(status: BillingInvoiceStatus): IconName {
  if (status === "finished") return "check";
  if (status === "red" || status === "rejected") return "warning";
  if (status === "sending") return "table";
  return "key";
}

function invoiceSearchText(invoice: BillingInvoiceLedgerRecord) {
  return [
    invoice.id,
    invoice.invoiceNo,
    invoice.invoiceTitle,
    invoice.taxNo,
    invoice.invoiceCode,
    invoice.invoiceElectronicNo,
    invoice.expressCompany,
    invoice.expressNo,
    invoice.billNo,
    invoice.orderNo,
    invoice.tenantCode,
    invoice.tenantName,
    invoice.region,
    invoice.industry,
    invoice.servicePlanName,
    invoice.tierName,
    invoice.auditorName,
    invoice.statusRemark,
    invoiceStatusLabel(invoice.invoiceStatus),
    invoiceTypeLabel(invoice.invoiceType),
    taxTypeLabel(invoice.invoiceTaxType),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesStatusFilter(
  invoice: BillingInvoiceLedgerRecord,
  filter: InvoiceStatusFilter,
) {
  if (filter === "all") return true;
  if (filter === "active")
    return (
      invoice.invoiceStatus === "issued" || invoice.invoiceStatus === "sending"
    );
  if (filter === "exception")
    return (
      invoice.invoiceStatus === "red" || invoice.invoiceStatus === "rejected"
    );
  return invoice.invoiceStatus === filter;
}

function matchesDeliveryFilter(
  invoice: BillingInvoiceLedgerRecord,
  filter: DeliveryFilter,
) {
  if (filter === "all") return true;
  if (filter === "not_sent")
    return invoice.invoiceStatus === "issued" && !invoice.expressNo;
  if (filter === "sent")
    return invoice.invoiceStatus === "sending" || Boolean(invoice.expressNo);
  return invoice.invoiceStatus === "finished";
}

const invoiceCsvColumns: CsvColumn<BillingInvoiceLedgerRecord>[] = [
  { label: "发票号", value: (v) => v.invoiceNo },
  { label: "发票抬头", value: (v) => v.invoiceTitle },
  { label: "税号", value: (v) => v.taxNo ?? "" },
  { label: "抬头类型", value: (v) => taxTypeLabel(v.invoiceTaxType) },
  { label: "发票类型", value: (v) => invoiceTypeLabel(v.invoiceType) },
  { label: "租户编码", value: (v) => v.tenantCode },
  { label: "租户名称", value: (v) => v.tenantName },
  { label: "关联账单", value: (v) => v.billNo },
  { label: "订单编号", value: (v) => v.orderNo ?? "" },
  { label: "币种", value: (v) => v.currency },
  { label: "开票金额", value: (v) => v.invoiceAmount },
  { label: "税额", value: (v) => v.taxAmount },
  { label: "账单应收", value: (v) => v.billPayableAmount },
  { label: "发票状态", value: (v) => invoiceStatusLabel(v.invoiceStatus) },
  { label: "快递公司", value: (v) => v.expressCompany ?? "" },
  { label: "快递单号", value: (v) => v.expressNo ?? "" },
  { label: "开票时间", value: (v) => formatDate(v.issuedAt) },
  { label: "审核人", value: (v) => v.auditorName },
];

function InvoiceActionsMenu({
  invoice,
  onReceiptAction,
}: {
  invoice: BillingInvoiceLedgerRecord;
  onReceiptAction: (
    invoice: BillingInvoiceLedgerRecord,
    action: BillingInvoiceReceiptAction,
  ) => void;
}) {
  const tShared = useTranslations();
  const router = useRouter();

  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${invoice.invoiceNo} 发票操作`}
        items={[
          {
            id: "bill",
            label: "账单详情",
            icon: "arrow-right",
            onSelect: () =>
              router.push(`/billing/${encodeURIComponent(invoice.billId)}`),
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(invoice.tenantId)}`),
          },
          /* 三支动作由同一份定义生成（`InvoiceReceiptActionDialog` 里的
             label / 可用性 / 禁用理由三个 helper）。`red` 单独一支而不是
             `danger: action === "red"`——DS 的判别联合要的是字面量 `true`，
             一个算出来的 boolean 判别不了。这不是类型在找麻烦：`danger` 的分支
             本来就要多带一样东西（confirm 或 confirmExempt），三元表达不了。 */
          ...(["update_shipping", "finish", "red"] as const).map(
            (action): ActionMenuItem =>
              action === "red"
                ? {
                    id: action,
                    label: invoiceReceiptActionLabel(action),
                    icon: "warning",
                    disabled: !canRunInvoiceReceiptAction(action, invoice),
                    hint:
                      invoiceReceiptActionDisabledReason(action, invoice) ??
                      undefined,
                    danger: true,
                    /* **点这一项不会红冲。** 它打开的是红冲登记表单（收红冲
                       原因与寄送信息），真正的落锤是那张表的提交，而那一步还
                       包着 step-up 二次验证——两道门都在后面，这里再插一道确认
                       框只会让人多点一次。表单里 `actionDescription("red")` 已经
                       写明后果。 */
                    confirmExempt:
                      "这一项只打开红冲登记表单，不直接生效；红冲发生在表单提交时，且那一步走 step-up 二次验证",
                    onSelect: () => onReceiptAction(invoice, action),
                  }
                : {
                    id: action,
                    label: invoiceReceiptActionLabel(action),
                    icon: action === "finish" ? "check" : "table",
                    disabled: !canRunInvoiceReceiptAction(action, invoice),
                    hint:
                      invoiceReceiptActionDisabledReason(action, invoice) ??
                      undefined,
                    onSelect: () => onReceiptAction(invoice, action),
                  },
          ),
        ]}
      />
    </div>
  );
}

/**
 * 行内的状态标仍是 pill（`vx-invoice-pill--*`）而非 `StatusBadge`：那一族是业务
 * 值域着色表，整族改 Badge 归批 4，一次改动不跨两个语义面。
 */
function useInvoiceColumns(): DataTableColumn<BillingInvoiceLedgerRecord>[] {
  const tShared = useTranslations();
  const router = useRouter();

  return [
    {
      id: "invoice",
      header: "发票",
      cell: (invoice) => (
        <TableTitleCell
          title={invoice.invoiceNo}
          description={`${invoice.invoiceTitle} · ${taxTypeLabel(invoice.invoiceTaxType)}`}
          onTitleClick={() =>
            router.push(`/billing/${encodeURIComponent(invoice.billId)}`)
          }
        />
      ),
    },
    {
      id: "tenant",
      header: "租户",
      cell: (invoice) => (
        <TableTitleCell
          icon={invoice.tenantType === "company" ? "buildings" : "user"}
          title={invoice.tenantName}
          description={`${invoice.tenantCode} · ${typeLabel(invoice.tenantType)}`}
        />
      ),
    },
    {
      id: "bill",
      header: "账单",
      cell: (invoice) => (
        <TableTitleCell
          title={
            <span className="inline-flex flex-wrap gap-2xs">
              <StatusBadge tone={BILL_STATUS_TONE[invoice.billStatus]}>
                {billStatusLabel(invoice.billStatus)}
              </StatusBadge>
              <Badge
                className={`vx-tenant-pill vx-invoice-pill--bill-type-${invoice.billType}`}
              >
                {billTypeLabel(invoice.billType)}
              </Badge>
            </span>
          }
          description={invoice.billNo}
        />
      ),
    },
    {
      id: "amount",
      header: "金额",
      align: "right",
      cell: (invoice) => (
        <TableTitleCell
          title={formatCurrency(invoice.invoiceAmount, invoice.currency)}
          description={`税额 ${formatCurrency(invoice.taxAmount, invoice.currency)}`}
        />
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (invoice) => (
        <TableTitleCell
          title={
            <StatusBadge
              tone={INVOICE_STATUS_TONE[invoice.invoiceStatus]}
              icon={invoiceStatusIcon(invoice.invoiceStatus)}
            >
              {invoiceStatusLabel(invoice.invoiceStatus)}
            </StatusBadge>
          }
          description={invoiceTypeLabel(invoice.invoiceType)}
        />
      ),
    },
    {
      id: "delivery",
      header: "寄送",
      cell: (invoice) => (
        <TableTitleCell
          title={
            invoice.expressNo
              ? (invoice.expressCompany ?? "线下寄送")
              : invoice.invoiceFileUrl
                ? "电子文件"
                : "未寄送"
          }
          description={
            invoice.expressNo ??
            invoice.invoiceFileUrl ??
            formatDate(invoice.sendAt)
          }
        />
      ),
    },
  ];
}

function InvoiceCards({
  invoices,
  onReceiptAction,
}: {
  invoices: BillingInvoiceLedgerRecord[];
  onReceiptAction: (
    invoice: BillingInvoiceLedgerRecord,
    action: BillingInvoiceReceiptAction,
  ) => void;
}) {
  const tShared = useTranslations();
  const router = useRouter();

  return (
    <ListCardGrid aria-label="线下发票卡片">
      {invoices.map((invoice) => (
        <MetricListCard
          key={invoice.id}
          icon="key"
          title={invoice.invoiceNo}
          description={`${invoice.tenantName} · ${invoice.invoiceTitle}`}
          tone={resolveStatusTone(INVOICE_STATUS_TONE, invoice.invoiceStatus)}
          onClick={() =>
            router.push(`/billing/${encodeURIComponent(invoice.billId)}`)
          }
          actions={
            <InvoiceActionsMenu
              invoice={invoice}
              onReceiptAction={onReceiptAction}
            />
          }
          badges={
            <>
              <StatusBadge tone={INVOICE_STATUS_TONE[invoice.invoiceStatus]}>
                {invoiceStatusLabel(invoice.invoiceStatus)}
              </StatusBadge>
              <Badge
                className={`vx-tenant-pill vx-invoice-pill--tax-${invoice.invoiceTaxType}`}
              >
                {taxTypeLabel(invoice.invoiceTaxType)}
              </Badge>
              <Badge
                className={`vx-tenant-pill vx-invoice-pill--doc-type-${invoice.invoiceType}`}
              >
                {invoiceTypeLabel(invoice.invoiceType)}
              </Badge>
            </>
          }
          note={`${invoice.billNo} · ${invoice.servicePlanName ?? invoice.orderNo ?? "未关联订阅"}`}
          metrics={[
            {
              key: "invoiced",
              value: formatCurrency(invoice.invoiceAmount, invoice.currency),
              label: "开票金额",
            },
            {
              key: "payable",
              value: formatCurrency(
                invoice.billPayableAmount,
                invoice.currency,
              ),
              label: "账单应收",
            },
            {
              key: "delivery",
              value: invoice.expressNo
                ? "已寄送"
                : invoice.invoiceStatus === "finished"
                  ? tShared("status.generic.completed")
                  : tShared("status.generic.pending"),
              label: "交付状态",
            },
          ]}
          footer={
            <>
              <span className="truncate">
                {formatDate(invoice.issuedAt)} · {invoice.auditorName}
              </span>
              <span className="shrink-0">
                {invoice.sourceLabel === "offline"
                  ? "线下登记"
                  : invoice.sourceLabel}
              </span>
            </>
          }
        />
      ))}
    </ListCardGrid>
  );
}

export function InvoicesPage() {
  const tShared = useTranslations();
  const [invoices, setInvoices] = useState<BillingInvoiceLedgerRecord[]>([]);
  const [invoicesTruncated, setInvoicesTruncated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [invoiceTypeFilter, setInvoiceTypeFilter] =
    useState<InvoiceTypeFilter>("all");
  const [taxFilter, setTaxFilter] = useState<InvoiceTaxFilter>("all");
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [receiptActionTarget, setReceiptActionTarget] = useState<{
    invoice: BillingInvoiceLedgerRecord;
    action: BillingInvoiceReceiptAction;
  } | null>(null);
  const [submittingReceiptAction, setSubmittingReceiptAction] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<string | null>(
    null,
  );
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    fetchInvoiceLedgerRecords()
      .then((records) => {
        if (active) {
          setInvoices(records);
          setInvoicesTruncated(isListTruncated(records));
        }
      })
      .catch((error) => {
        if (active) {
          setInvoices([]);
          setInvoicesTruncated(false);
          setLoadError(
            error instanceof Error ? error.message : "发票数据读取失败",
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

  const invoiceColumns = useInvoiceColumns();

  const filteredInvoices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return invoices.filter((invoice) => {
      if (!matchesStatusFilter(invoice, statusFilter)) return false;
      if (
        invoiceTypeFilter !== "all" &&
        invoice.invoiceType !== invoiceTypeFilter
      )
        return false;
      if (taxFilter !== "all" && invoice.invoiceTaxType !== taxFilter)
        return false;
      if (!matchesDeliveryFilter(invoice, deliveryFilter)) return false;
      if (
        normalizedQuery &&
        !invoiceSearchText(invoice).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [
    deliveryFilter,
    invoiceTypeFilter,
    invoices,
    query,
    statusFilter,
    taxFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredInvoices.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleInvoices = filteredInvoices.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const validInvoices = invoices.filter(
    (item) => item.invoiceStatus !== "red" && item.invoiceStatus !== "rejected",
  );
  const invoiceAmount = validInvoices.reduce(
    (sum, item) => sum + item.invoiceAmount,
    0,
  );
  const deliveryPendingCount = invoices.filter(
    (item) =>
      item.invoiceStatus === "issued" || item.invoiceStatus === "sending",
  ).length;
  const finishedCount = invoices.filter(
    (item) => item.invoiceStatus === "finished",
  ).length;
  const exceptionCount = invoices.filter(
    (item) => item.invoiceStatus === "red" || item.invoiceStatus === "rejected",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [
    deliveryFilter,
    invoiceTypeFilter,
    pageSize,
    query,
    statusFilter,
    taxFilter,
    viewMode,
  ]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setInvoiceTypeFilter("all");
    setTaxFilter("all");
    setDeliveryFilter("all");
  }

  function handleExportSelected() {
    const rows = filteredInvoices.filter((invoice) =>
      selectedInvoiceIds.has(invoice.id),
    );
    exportRowsToCsv("invoice-selected-export", invoiceCsvColumns, rows);
  }

  function clearInvoiceSelection() {
    setSelectedInvoiceIds(new Set());
  }

  function requestReceiptAction(
    invoice: BillingInvoiceLedgerRecord,
    action: BillingInvoiceReceiptAction,
  ) {
    setOperationError(null);
    setOperationFeedback(null);
    setReceiptActionTarget({ invoice, action });
  }

  async function handleSubmitReceiptAction(
    payload: Parameters<typeof submitBillingInvoiceReceiptAction>[2],
  ) {
    if (!receiptActionTarget) return;

    setSubmittingReceiptAction(true);
    setOperationError(null);

    try {
      await submitBillingInvoiceReceiptAction(
        receiptActionTarget.invoice.billId,
        receiptActionTarget.invoice.id,
        payload,
      );
      const records = await fetchInvoiceLedgerRecords();
      setInvoices(records);
      setInvoicesTruncated(isListTruncated(records));
      setOperationFeedback(
        `${invoiceReceiptActionLabel(receiptActionTarget.action)}已同步登记。`,
      );
      setReceiptActionTarget(null);
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "发票后续动作登记失败，请稍后重试。",
      );
    } finally {
      setSubmittingReceiptAction(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-invoices-page"
        header={
          <PageHeader
            icon="key"
            eyebrow="财务结算"
            title="发票管理"
            description="线下发票台账 MVP：集中查看人工登记的发票、寄送状态和红冲/作废结果，不调用在线开票接口。"
            action={
              <Button asChild variant="outline">
                <Link href="/billing">
                  <Icon name="table" size="xs" fallback="placeholder" />
                  账单登记入口
                </Link>
              </Button>
            }
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="发票统计"
              items={[
                {
                  id: "total",
                  help: "当前筛选条件下的发票条数。",
                  icon: "key",
                  label: "发票总数",
                  value: formatNumber(invoices.length),
                  tags: [`筛选 ${formatNumber(filteredInvoices.length)}`],
                },
                {
                  id: "amount",
                  help: "有效发票（排除红冲与驳回）的开票金额合计。",
                  icon: "chart-bar",
                  label: "有效开票",
                  value: formatCurrency(invoiceAmount, "CNY"),
                  tags: [`完成 ${formatNumber(finishedCount)}`],
                  tone: "success",
                },
                {
                  id: "delivery-pending",
                  help: "已开具或发送中、尚未确认交付的发票。",
                  icon: "table",
                  label: "待交付",
                  value: formatNumber(deliveryPendingCount),
                  tags: [`线下 ${formatNumber(invoices.length)}`],
                  tone: deliveryPendingCount ? "warning" : "success",
                },
                {
                  id: "exception",
                  help: "红冲与被驳回的发票。",
                  icon: "warning",
                  label: "发票异常",
                  value: formatNumber(exceptionCount),
                  tags: ["红冲/驳回"],
                  tone: exceptionCount ? "danger" : "success",
                },
              ]}
            />
            {operationFeedback ? (
              <div className="vx-subscription-operation-feedback">
                {operationFeedback}
              </div>
            ) : null}
            {invoicesTruncated ? (
              <Banner
                tone="warning"
                title="当前发票列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标发票，请尝试缩小筛选范围（如按状态、类型等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredInvoices.length)}
            aria-label="发票筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索发票、租户、账单、快递"
                className="vx-tenant-search vx-invoice-search"
                aria-label="搜索发票"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton
                  variant={selectedInvoiceIds.size > 0 ? "default" : "outline"}
                  icon="arrow-down"
                  onClick={handleExportSelected}
                  disabled={selectedInvoiceIds.size === 0}
                >
                  {tShared("common.export")}
                </ActionButton>
              </>
            }
          >
            <div className="vx-tenant-filters">
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as InvoiceStatusFilter)
                }
                aria-label="发票状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">待交付</option>
                <option value="issued">已开票</option>
                <option value="sending">寄送中</option>
                <option value="finished">
                  {tShared("status.generic.completed")}
                </option>
                <option value="exception">异常发票</option>
                <option value="red">已红冲</option>
                <option value="rejected">
                  {tShared("status.generic.rejected")}
                </option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={invoiceTypeFilter}
                onChange={(event) =>
                  setInvoiceTypeFilter(event.target.value as InvoiceTypeFilter)
                }
                aria-label="发票类型"
              >
                <option value="all">{tShared("filters.allKinds")}</option>
                <option value="special_vat">增值税专票</option>
                <option value="normal_vat">增值税普票</option>
                <option value="electronic">电子发票</option>
                <option value="paper">纸质发票</option>
                <option value="other">{tShared("common.other")}</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={taxFilter}
                onChange={(event) =>
                  setTaxFilter(event.target.value as InvoiceTaxFilter)
                }
                aria-label="抬头类型"
              >
                <option value="all">全部抬头</option>
                <option value="enterprise">企业</option>
                <option value="individual">个人</option>
                <option value="government">政府/事业单位</option>
                <option value="other">{tShared("common.other")}</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={deliveryFilter}
                onChange={(event) =>
                  setDeliveryFilter(event.target.value as DeliveryFilter)
                }
                aria-label="交付状态"
              >
                <option value="all">全部交付</option>
                <option value="not_sent">未寄送</option>
                <option value="sent">已寄送</option>
                <option value="finished">
                  {tShared("status.generic.completed")}
                </option>
              </NativeSelect>
            </div>
          </FilterBar>
        }
        bulkBar={
          selectedInvoiceIds.size > 0 ? (
            <BulkActionBar
              count={selectedInvoiceIds.size}
              actions={[
                {
                  id: "export",
                  label: tShared("common.exportSelected"),
                  icon: "table",
                  onSelect: handleExportSelected,
                },
              ]}
              onClear={clearInvoiceSelection}
            />
          ) : null
        }
        table={
          <section className="vx-tenant-directory" aria-label="发票清单">
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="vx-tenant-directory__header">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={invoiceColumns}
                rows={visibleInvoices}
                rowKey={(invoice) => invoice.id}
                loading={loading}
                indexStart={(activePage - 1) * pageSize + 1}
                selectedKeys={[...selectedInvoiceIds]}
                onSelectionChange={(keys) =>
                  setSelectedInvoiceIds(new Set(keys))
                }
                rowActions={(invoice) => (
                  <InvoiceActionsMenu
                    invoice={invoice}
                    onReceiptAction={requestReceiptAction}
                  />
                )}
                empty={
                  <EmptyState
                    title={loadError ? "发票数据读取失败" : "没有匹配的发票"}
                    description={
                      loadError ?? "清空筛选条件后可查看全部线下发票记录。"
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
            ) : visibleInvoices.length ? (
              <InvoiceCards
                invoices={visibleInvoices}
                onReceiptAction={requestReceiptAction}
              />
            ) : (
              <EmptyState
                title={loading ? "正在加载发票" : "没有匹配的发票"}
                description={
                  loading
                    ? "正在读取线下发票台账。"
                    : (loadError ?? "清空筛选条件后可查看全部线下发票记录。")
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
            )}
          </section>
        }
        footer={
          <ListPagination
            currentPage={activePage}
            pageCount={pageCount}
            total={filteredInvoices.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />

      {receiptActionTarget ? (
        <InvoiceReceiptActionDialog
          receipt={receiptActionTarget.invoice}
          action={receiptActionTarget.action}
          busy={submittingReceiptAction}
          error={operationError}
          onCancel={() => {
            if (!submittingReceiptAction) setReceiptActionTarget(null);
          }}
          onSubmit={handleSubmitReceiptAction}
        />
      ) : null}
    </>
  );
}
