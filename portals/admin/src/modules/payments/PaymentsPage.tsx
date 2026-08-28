"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Banner,
  BulkActionBar,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  Label,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  Textarea,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { ActionMenuItem, IconName } from "@vxture/design-system";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { isListTruncated } from "@/lib/list-truncation";
import {
  AdminBffError,
  fetchPaymentOperations,
  rejectPayment,
  verifyPayment,
} from "@/api/admin-bff";
import type {
  OrderOfflinePaymentType,
  OrderPaymentStatus,
  OrderPaySource,
  PaymentOperationRecord,
  PaymentReconciliationStatus,
} from "@/entities/console";
import {
  BILL_STATUS_TONE,
  PAYMENT_STATUS_TONE,
  RECONCILIATION_TONE,
} from "@/modules/shared/status-tone";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  formatDate,
  formatNumber,
  typeLabel,
} from "@/modules/tenants/tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";

type TFn = ReturnType<typeof useTranslations>;

type PaymentStatusFilter = "all" | OrderPaymentStatus;
type PaySourceFilter = "all" | OrderPaySource;
type ReconciliationFilter = "all" | "attention" | PaymentReconciliationStatus;
type OfflineTypeFilter = "all" | OrderOfflinePaymentType | "online" | "none";

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

function paySourceLabel(source: OrderPaySource) {
  if (source === "online") return "线上";
  if (source === "offline") return "线下";
  return "无";
}

function offlineTypeLabel(type: OrderOfflinePaymentType | null) {
  if (type === "bank_transfer") return "银行转账";
  if (type === "cash") return "现金";
  if (type === "other") return "其他线下";
  return "未设置";
}

function billStatusLabel(status: PaymentOperationRecord["billStatus"]) {
  if (status === "paid") return "已结清";
  if (status === "partial") return "部分收款";
  if (status === "paying") return "支付中";
  if (status === "cancelled") return "已作废";
  if (status === "overdue") return "逾期";
  if (status === "unpaid") return "待收款";
  return "未关联";
}

function reconciliationLabel(status: PaymentReconciliationStatus) {
  if (status === "pending_verify") return "待复核";
  if (status === "partial") return "部分收款";
  if (status === "overpaid") return "超额收款";
  if (status === "bill_cancelled") return "账单作废";
  if (status === "failed") return "支付异常";
  if (status === "unlinked") return "未关联";
  return "已对账";
}

function reconciliationIcon(status: PaymentReconciliationStatus): IconName {
  if (status === "normal") return "check";
  if (status === "pending_verify" || status === "partial") return "clock";
  if (status === "unlinked") return "info";
  return "warning";
}

function paymentStatusIcon(status: OrderPaymentStatus): IconName {
  if (status === "paid") return "check";
  if (status === "failed" || status === "refunding") return "warning";
  if (status === "closed") return "x";
  return "clock";
}

/* 从模块级常量改成收 `t` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的状态文案要按界面语言取。 */
function paymentCsvColumns(
  t: TFn,
): readonly CsvColumn<PaymentOperationRecord>[] {
  return [
    { label: "收款流水", value: (p) => p.paymentNo },
    { label: "交易号", value: (p) => p.transactionId ?? "" },
    { label: "关联订单", value: (p) => p.orderNo ?? "" },
    { label: "关联账单", value: (p) => p.billNo ?? "" },
    { label: "租户编码", value: (p) => p.tenantCode },
    { label: "租户名称", value: (p) => p.tenantName },
    { label: "收款金额", value: (p) => p.paidAmount },
    {
      label: "账单应收",
      value: (p) => p.billPayableAmount || p.totalAmount,
    },
    { label: "币种", value: (p) => p.currency },
    {
      label: "收款状态",
      value: (p) => t(`status.paymentLedger.${p.paymentStatus}`),
    },
    { label: "支付来源", value: (p) => paySourceLabel(p.paySource) },
    {
      label: "收款方式",
      value: (p) =>
        p.paySource === "offline"
          ? offlineTypeLabel(p.offlinePayType)
          : (p.payMethod ?? ""),
    },
    {
      label: "对账状态",
      value: (p) => reconciliationLabel(p.reconciliationStatus),
    },
    { label: "操作人", value: (p) => p.operatorName },
    { label: "收款时间", value: (p) => p.paidAt ?? p.createdAt },
  ];
}

/* 收 `t` 往下传：搜索文本里含状态文案，那些现在从词条取。 */
function paymentSearchText(
  payment: PaymentOperationRecord,
  t: ReturnType<typeof useTranslations>,
) {
  return [
    payment.id,
    payment.paymentNo,
    payment.transactionId,
    payment.channelOrderNo,
    payment.channelTransactionNo,
    payment.offlinePayerName,
    payment.billNo,
    payment.orderNo,
    payment.tenantCode,
    payment.tenantName,
    payment.region,
    payment.industry,
    payment.servicePlanName,
    payment.tierName,
    payment.operatorName,
    payment.statusMessage,
    payment.remark,
    t(`status.paymentLedger.${payment.paymentStatus}`),
    paySourceLabel(payment.paySource),
    offlineTypeLabel(payment.offlinePayType),
    reconciliationLabel(payment.reconciliationStatus),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesReconciliationFilter(
  payment: PaymentOperationRecord,
  filter: ReconciliationFilter,
) {
  if (filter === "all") return true;
  if (filter === "attention") return payment.reconciliationStatus !== "normal";
  return payment.reconciliationStatus === filter;
}

function matchesOfflineTypeFilter(
  payment: PaymentOperationRecord,
  filter: OfflineTypeFilter,
) {
  if (filter === "all") return true;
  if (filter === "online" || filter === "none")
    return payment.paySource === filter;
  return payment.offlinePayType === filter;
}

function paymentTargetHref(payment: PaymentOperationRecord) {
  if (payment.billId) return `/billing/${encodeURIComponent(payment.billId)}`;
  return `/tenants/${encodeURIComponent(payment.tenantId)}`;
}

function PaymentRemarkDialog({
  title,
  payment,
  remark,
  loading,
  error,
  onRemarkChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  payment: PaymentOperationRecord;
  remark: string;
  loading: boolean;
  error: string | null;
  onRemarkChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const tShared = useTranslations();
  return (
    <DialogForm
      open
      title={title}
      description={
        <>
          流水号：<strong>{payment.paymentNo}</strong>
          {payment.tenantName ? `  ·  ${payment.tenantName}` : ""}
        </>
      }
      submitLabel="确认"
      cancelLabel={tShared("actions.cancel")}
      submitting={loading}
      submitDisabled={remark.trim().length < 4}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    >
      <Label htmlFor="vx-payment-remark">
        操作备注 <small>（必填，最少 4 字）</small>
      </Label>
      <Textarea
        id="vx-payment-remark"
        value={remark}
        onChange={(e) => onRemarkChange(e.target.value)}
        rows={3}
        placeholder="请输入操作备注…"
        autoFocus
      />
      {error ? <p className="text-sm text-vx-danger">{error}</p> : null}
    </DialogForm>
  );
}

function PaymentActionsMenu({
  payment,
  onVerify,
  onReject,
}: {
  payment: PaymentOperationRecord;
  onVerify: (payment: PaymentOperationRecord) => void;
  onReject: (payment: PaymentOperationRecord) => void;
}) {
  const tShared = useTranslations();
  const router = useRouter();
  const isPendingVerify = payment.paymentStatus === "pending_verify";

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${payment.paymentNo} 收款操作`}
        items={[
          // 标注为 ActionMenuItem[]：条件展开会把字面量 icon 拓宽成 string，
          // 而 ActionMenuItem.icon 现在收的是 IconName 联合。
          ...(isPendingVerify
            ? ([
                {
                  id: "verify",
                  label: "核销确认",
                  icon: "check",
                  onSelect: () => onVerify(payment),
                },
                {
                  id: "reject",
                  label: "驳回退回",
                  icon: "x",
                  onSelect: () => onReject(payment),
                },
              ] satisfies ActionMenuItem[])
            : []),
          {
            id: "bill",
            label: "账单详情",
            icon: "arrow-right",
            disabled: !payment.billId,
            onSelect: () => {
              if (!payment.billId) return;
              router.push(`/billing/${encodeURIComponent(payment.billId)}`);
            },
          },
          {
            id: "order",
            label: "订单详情",
            icon: "table",
            disabled: !payment.subscriptionId,
            onSelect: () => {
              if (!payment.subscriptionId) return;
              router.push(
                `/orders/${encodeURIComponent(payment.subscriptionId)}`,
              );
            },
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(payment.tenantId)}`),
          },
          {
            id: "evidence",
            label: "查看凭证",
            icon: "key",
            disabled: !payment.offlineEvidenceUrl,
            onSelect: () => {
              if (!payment.offlineEvidenceUrl) return;
              globalThis.open(
                payment.offlineEvidenceUrl,
                "_blank",
                "noopener,noreferrer",
              );
            },
          },
        ]}
      />
    </div>
  );
}

/**
 * 行内的状态标仍是 pill（`vx-payment-pill--*`）而非 `StatusBadge`：那一族是业务
 * 值域着色表，整族改 Badge 归批 4，一次改动不跨两个语义面。
 */
function usePaymentColumns(): DataTableColumn<PaymentOperationRecord>[] {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();

  return [
    {
      id: "payment",
      header: "收款流水",
      cell: (payment) => (
        <TableTitleCell
          title={payment.paymentNo}
          description={`${paySourceLabel(payment.paySource)} · ${
            payment.paySource === "offline"
              ? offlineTypeLabel(payment.offlinePayType)
              : (payment.payMethod ?? "未设置")
          }`}
          onTitleClick={() => router.push(paymentTargetHref(payment))}
        />
      ),
    },
    {
      id: "tenant",
      header: "租户",
      cell: (payment) => (
        <TableTitleCell
          icon={payment.tenantType === "company" ? "buildings" : "user"}
          title={payment.tenantName}
          description={`${payment.tenantCode} · ${typeLabel(payment.tenantType)}`}
        />
      ),
    },
    {
      id: "bill",
      header: "关联账单",
      cell: (payment) => (
        <TableTitleCell
          title={
            <span className="inline-flex flex-wrap gap-2xs">
              <StatusBadge
                tone={
                  payment.billStatus
                    ? BILL_STATUS_TONE[payment.billStatus]
                    : "neutral"
                }
              >
                {billStatusLabel(payment.billStatus)}
              </StatusBadge>
              <StatusBadge tone="neutral" icon={false}>
                {payment.orderNo ?? "未关联订单"}
              </StatusBadge>
            </span>
          }
          description={payment.billNo ?? "未关联账单"}
        />
      ),
    },
    {
      id: "amount",
      header: "金额",
      align: "right",
      cell: (payment) => (
        <TableTitleCell
          title={formatCurrency(payment.paidAmount, payment.currency)}
          description={`应收 ${formatCurrency(
            payment.billPayableAmount || payment.totalAmount,
            payment.currency,
          )}`}
        />
      ),
    },
    {
      id: "status",
      header: "收款状态",
      align: "center",
      cell: (payment) => (
        <TableTitleCell
          title={
            <StatusBadge
              tone={PAYMENT_STATUS_TONE[payment.paymentStatus]}
              icon={paymentStatusIcon(payment.paymentStatus)}
            >
              {t(`status.paymentLedger.${payment.paymentStatus}`)}
            </StatusBadge>
          }
          description={formatDate(payment.paidAt ?? payment.createdAt, locale)}
        />
      ),
    },
    {
      id: "reconcile",
      header: "对账",
      align: "center",
      cell: (payment) => (
        <TableTitleCell
          title={
            <StatusBadge
              tone={RECONCILIATION_TONE[payment.reconciliationStatus]}
              icon={reconciliationIcon(payment.reconciliationStatus)}
            >
              {reconciliationLabel(payment.reconciliationStatus)}
            </StatusBadge>
          }
          description={payment.remark ?? payment.operatorName}
        />
      ),
    },
  ];
}

export function PaymentsPage() {
  const t = useTranslations();
  const tShared = useTranslations();
  const { runWithStepUp } = useStepUp();
  const [payments, setPayments] = useState<PaymentOperationRecord[]>([]);
  const [paymentsTruncated, setPaymentsTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] =
    useState<PaymentStatusFilter>("all");
  const [paySourceFilter, setPaySourceFilter] =
    useState<PaySourceFilter>("all");
  const [reconciliationFilter, setReconciliationFilter] =
    useState<ReconciliationFilter>("all");
  const [offlineTypeFilter, setOfflineTypeFilter] =
    useState<OfflineTypeFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [verifyTarget, setVerifyTarget] =
    useState<PaymentOperationRecord | null>(null);
  const [rejectTarget, setRejectTarget] =
    useState<PaymentOperationRecord | null>(null);
  const [remarkInput, setRemarkInput] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    fetchPaymentOperations()
      .then((records) => {
        if (active) {
          setPayments(records);
          setPaymentsTruncated(isListTruncated(records));
        }
      })
      .catch((error) => {
        if (active) {
          setPayments([]);
          setPaymentsTruncated(false);
          setLoadError(
            error instanceof Error ? error.message : "收款记录读取失败",
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

  const paymentColumns = usePaymentColumns();

  const filteredPayments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return payments.filter((payment) => {
      if (
        paymentStatusFilter !== "all" &&
        payment.paymentStatus !== paymentStatusFilter
      )
        return false;
      if (paySourceFilter !== "all" && payment.paySource !== paySourceFilter)
        return false;
      if (!matchesReconciliationFilter(payment, reconciliationFilter))
        return false;
      if (!matchesOfflineTypeFilter(payment, offlineTypeFilter)) return false;
      if (
        normalizedQuery &&
        !paymentSearchText(payment, t).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [
    /* `t` 进依赖：过滤要读状态文案（`billingSearchText` / `paymentSearchText`
       内部用它查词条）。next-intl 的 translator 按 (命名空间, messages, locale)
       记忆化，只在切语言时换身份，所以这不会让 memo 每次渲染失效，反而保证
       切语言时搜索匹配的是新语言的文案。这里没有 effect 依赖它。 */
    offlineTypeFilter,
    paymentStatusFilter,
    payments,
    paySourceFilter,
    query,
    reconciliationFilter,
    t,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredPayments.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visiblePayments = filteredPayments.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const paidPayments = payments.filter((item) => item.paymentStatus === "paid");
  const paidAmount = paidPayments.reduce(
    (sum, item) => sum + item.paidAmount,
    0,
  );
  const offlineAmount = paidPayments
    .filter((item) => item.paySource === "offline")
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const pendingVerifyCount = payments.filter(
    (item) => item.paymentStatus === "pending_verify",
  ).length;
  const partialCount = payments.filter(
    (item) => item.reconciliationStatus === "partial",
  ).length;
  const attentionCount = payments.filter(
    (item) => item.reconciliationStatus !== "normal",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [
    offlineTypeFilter,
    pageSize,
    paymentStatusFilter,
    paySourceFilter,
    query,
    reconciliationFilter,
  ]);

  function handleReset() {
    setQuery("");
    setPaymentStatusFilter("all");
    setPaySourceFilter("all");
    setReconciliationFilter("all");
    setOfflineTypeFilter("all");
  }

  function handleOpenVerify(payment: PaymentOperationRecord) {
    setVerifyTarget(payment);
    setRejectTarget(null);
    setRemarkInput("");
    setActionError(null);
  }

  function handleOpenReject(payment: PaymentOperationRecord) {
    setRejectTarget(payment);
    setVerifyTarget(null);
    setRemarkInput("");
    setActionError(null);
  }

  function handleCloseDialog() {
    setVerifyTarget(null);
    setRejectTarget(null);
    setRemarkInput("");
    setActionError(null);
  }

  async function handleConfirmAction() {
    const target = verifyTarget ?? rejectTarget;
    if (!target || remarkInput.trim().length < 4) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const submit = verifyTarget ? verifyPayment : rejectPayment;
      // verify (核销) is 危 payment.settle → runWithStepUp drives the ceremony;
      // reject is routine and passes through unchanged.
      const updated = await runWithStepUp(() =>
        submit(target.id, remarkInput.trim()),
      );
      setPayments((current) =>
        current.map((p) => (p.id === updated.id ? updated : p)),
      );
      handleCloseDialog();
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      setActionError(
        err instanceof AdminBffError ? err.message : "操作失败，请重试",
      );
    } finally {
      setActionLoading(false);
    }
  }

  const selectedPayments = useMemo(
    () => payments.filter((payment) => selectedPaymentIds.has(payment.id)),
    [payments, selectedPaymentIds],
  );

  function clearPaymentSelection() {
    setSelectedPaymentIds(new Set());
  }

  return (
    <>
      <ListPageTemplate
        className="w-full vx-payments-page"
        header={
          <PageHeader
            icon="check"
            eyebrow="财务结算"
            title="收款管理"
            description="运营侧收款台账 MVP：集中查看线下/线上收款记录、账单关联和对账状态；确认收款仍从订单侧进入。"
            action={
              <Button asChild variant="outline">
                <Link href="/orders">
                  <Icon name="table" size="xs" fallback="placeholder" />
                  订单收款入口
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
              aria-label="收款统计"
              items={[
                {
                  id: "records",
                  help: "当前筛选条件下的收款记录条数。",
                  icon: "check",
                  label: "收款记录",
                  value: formatNumber(payments.length),
                  tags: [`筛选 ${formatNumber(filteredPayments.length)}`],
                },
                {
                  id: "paid-amount",
                  help: "已收款记录的金额合计。",
                  icon: "chart-bar",
                  label: tShared("columns.receivedAmount"),
                  value: formatCurrency(paidAmount, "CNY"),
                  tags: [`线下 ${formatCurrency(offlineAmount, "CNY")}`],
                  tone: "success",
                },
                {
                  id: "pending-verify",
                  help: "状态为待复核的收款记录。",
                  icon: "clock",
                  label: "待复核",
                  value: formatNumber(pendingVerifyCount),
                  tags: [`部分 ${formatNumber(partialCount)}`],
                  tone:
                    pendingVerifyCount || partialCount ? "warning" : "success",
                },
                {
                  id: "attention",
                  help: "对账状态非正常的收款记录。",
                  icon: "warning",
                  label: "需关注",
                  value: formatNumber(attentionCount),
                  tags: ["对账异常"],
                  tone: attentionCount ? "danger" : "success",
                },
              ]}
            />
            {paymentsTruncated ? (
              <Banner
                tone="warning"
                title="当前收款列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标收款记录，请尝试缩小筛选范围（如按状态、来源等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            count={formatNumber(filteredPayments.length)}
            aria-label="收款筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索流水、租户、账单、付款方"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索收款"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton
                  variant={selectedPaymentIds.size > 0 ? "default" : "outline"}
                  icon="arrow-down"
                  onClick={() =>
                    exportRowsToCsv(
                      "payments-export",
                      paymentCsvColumns(t),
                      filteredPayments.filter((item) =>
                        selectedPaymentIds.has(item.id),
                      ),
                    )
                  }
                  disabled={selectedPaymentIds.size === 0}
                >
                  {tShared("common.export")}
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={paymentStatusFilter}
                onChange={(event) =>
                  setPaymentStatusFilter(
                    event.target.value as PaymentStatusFilter,
                  )
                }
                aria-label="收款状态"
              >
                <option value="all">全部收款</option>
                <option value="pending">
                  {tShared("status.generic.paying")}
                </option>
                <option value="pending_verify">线下待核</option>
                <option value="paid">已收款</option>
                <option value="partial">
                  {tShared("status.generic.partiallyPaid")}
                </option>
                <option value="failed">支付失败</option>
                <option value="closed">
                  {tShared("status.generic.closed")}
                </option>
                <option value="refunding">退款中</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={paySourceFilter}
                onChange={(event) =>
                  setPaySourceFilter(event.target.value as PaySourceFilter)
                }
                aria-label="收款来源"
              >
                <option value="all">全部来源</option>
                <option value="offline">线下</option>
                <option value="online">线上</option>
                <option value="none">{tShared("common.none")}</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={reconciliationFilter}
                onChange={(event) =>
                  setReconciliationFilter(
                    event.target.value as ReconciliationFilter,
                  )
                }
                aria-label="对账状态"
              >
                <option value="all">全部对账</option>
                <option value="attention">需关注</option>
                <option value="normal">已对账</option>
                <option value="pending_verify">待复核</option>
                <option value="partial">
                  {tShared("status.generic.partiallyPaid")}
                </option>
                <option value="overpaid">超额收款</option>
                <option value="bill_cancelled">账单作废</option>
                <option value="failed">支付异常</option>
                <option value="unlinked">未关联</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={offlineTypeFilter}
                onChange={(event) =>
                  setOfflineTypeFilter(event.target.value as OfflineTypeFilter)
                }
                aria-label="收款方式"
              >
                <option value="all">全部方式</option>
                <option value="bank_transfer">银行转账</option>
                <option value="cash">现金</option>
                <option value="other">其他线下</option>
                <option value="online">线上</option>
                <option value="none">{tShared("common.none")}</option>
              </NativeSelect>
            </>
          </FilterBar>
        }
        bulkBar={
          selectedPaymentIds.size > 0 ? (
            <BulkActionBar
              count={selectedPaymentIds.size}
              actions={[
                {
                  id: "export",
                  label: tShared("common.exportSelected"),
                  onSelect: () =>
                    exportRowsToCsv(
                      "payments-export",
                      paymentCsvColumns(t),
                      selectedPayments,
                    ),
                },
              ]}
              onClear={clearPaymentSelection}
            />
          ) : null
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="收款清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}

            <DataTable
              columns={paymentColumns}
              rows={visiblePayments}
              rowKey={(payment) => payment.id}
              loading={loading}
              indexStart={(activePage - 1) * pageSize + 1}
              selectedKeys={[...selectedPaymentIds]}
              onSelectionChange={(keys) => setSelectedPaymentIds(new Set(keys))}
              rowActions={(payment) => (
                <PaymentActionsMenu
                  payment={payment}
                  onVerify={handleOpenVerify}
                  onReject={handleOpenReject}
                />
              )}
              empty={
                <EmptyState
                  title={loadError ? "收款记录读取失败" : "没有匹配的收款记录"}
                  description={
                    loadError ?? "清空筛选条件后可查看全部收款记录。"
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
            total={filteredPayments.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />

      {(verifyTarget ?? rejectTarget) ? (
        <PaymentRemarkDialog
          title={verifyTarget ? "核销线下收款" : "驳回线下收款"}
          payment={(verifyTarget ?? rejectTarget)!}
          remark={remarkInput}
          loading={actionLoading}
          error={actionError}
          onRemarkChange={setRemarkInput}
          onConfirm={handleConfirmAction}
          onCancel={handleCloseDialog}
        />
      ) : null}
    </>
  );
}
