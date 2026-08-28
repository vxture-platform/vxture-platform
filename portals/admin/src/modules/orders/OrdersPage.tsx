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
import {} from "@vxture-platform/shared";
import { ORDER_STATUS_TONE } from "@/modules/shared/status-tone";
import {
  TIER_FILTER_OPTIONS,
  tierBadgeClass,
  tierFilterOf,
  type TierFilterValue,
} from "@/modules/shared/tier-level";
import { isUnset, UNSET_LABEL } from "@/modules/shared/display";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { IconName } from "@vxture/design-system";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { isListTruncated } from "@/lib/list-truncation";
import {
  confirmOrderOfflinePayment,
  fetchOrderOperations,
} from "@/api/admin-bff";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import type {
  OrderOperationRecord,
  OrderOperationStatus,
  OrderPaymentStatus,
  OrderPaySource,
} from "@/entities/console";
import {
  canConfirmOrderOfflinePayment,
  confirmOfflinePaymentDisabledReason,
  OrderOfflinePaymentDialog,
} from "@/modules/orders/OrderOfflinePaymentDialog";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  formatDate,
  formatNumber,
  typeLabel,
} from "@/modules/tenants/tenant-utils";

type TFn = ReturnType<typeof useTranslations>;

type OrderStatusFilter = "all" | OrderOperationStatus;
type PaymentStatusFilter = "all" | OrderPaymentStatus;
type PaySourceFilter = "all" | OrderPaySource;
type TierFilter = "all" | TierFilterValue;

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function cycleLabel(cycle: OrderOperationRecord["cycleType"]) {
  if (cycle === "yearly") return "年付";
  if (cycle === "once") return "一次性";
  return "月付";
}

function orderStatusLabel(status: OrderOperationStatus) {
  if (status === "pending") return "待付款";
  if (status === "pending_verify") return "待复核";
  if (status === "confirmed") return "已确认";
  if (status === "overdue") return "逾期";
  if (status === "closed") return "已关闭";
  if (status === "paid_unprovisioned") return "已付未开通";
  if (status === "partial_pending") return "部分收款·挂账";
  return "异常";
}

function orderStatusIcon(status: OrderOperationStatus): IconName {
  if (status === "confirmed") return "check";
  if (status === "pending" || status === "pending_verify") return "clock";
  if (status === "closed") return "x";
  return "warning";
}

// 关注态置顶（product_321 §4.2）：钱在途/钱到了没开通/收了一半的单排最前，
// 运营一眼看到需要动手的行；同层内按创建时间倒序（保持既有习惯）。
const ATTENTION_RANK: Partial<Record<OrderOperationStatus, number>> = {
  pending_verify: 0,
  paid_unprovisioned: 1,
  partial_pending: 2,
};

function attentionRank(status: OrderOperationStatus): number {
  return ATTENTION_RANK[status] ?? 9;
}

function paySourceLabel(source: OrderPaySource) {
  if (source === "online") return "线上";
  if (source === "offline") return "线下";
  return "无";
}

/* 从模块级常量改成收 `t` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的状态文案要按界面语言取。 */
function orderCsvColumns(t: TFn): readonly CsvColumn<OrderOperationRecord>[] {
  return [
    { label: "订单号", value: (o) => o.orderNo },
    { label: "账单号", value: (o) => o.billNo ?? "" },
    { label: "租户编码", value: (o) => o.tenantCode },
    { label: "租户名称", value: (o) => o.tenantName },
    { label: "业务方案", value: (o) => o.solutionName },
    { label: "套餐", value: (o) => o.servicePlanName },
    { label: "版本", value: (o) => o.tierName },
    { label: "计费周期", value: (o) => cycleLabel(o.cycleType) },
    { label: "订单金额", value: (o) => o.amount },
    { label: "已收金额", value: (o) => o.paidAmount },
    { label: "币种", value: (o) => o.currency },
    { label: "订单状态", value: (o) => orderStatusLabel(o.orderStatus) },
    {
      label: "支付状态",
      value: (o) => t(`status.orderPayment.${o.paymentStatus}`),
    },
    { label: "支付来源", value: (o) => paySourceLabel(o.paySource) },
    { label: "创建时间", value: (o) => o.createdAt },
  ];
}

function orderSearchText(record: OrderOperationRecord) {
  return [
    record.id,
    record.orderNo,
    record.billNo,
    record.paymentNo,
    record.tenantCode,
    record.tenantName,
    record.region,
    record.industry,
    record.solutionName,
    record.servicePlanName,
    record.tierName,
    record.operatorName,
    record.operationHint,
    record.orderStatus,
    record.paymentStatus,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function OrderActionsMenu({
  order,
  onConfirmPayment,
}: {
  order: OrderOperationRecord;
  onConfirmPayment: (order: OrderOperationRecord) => void;
}) {
  const tShared = useTranslations();
  const router = useRouter();

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${order.orderNo} 订单操作`}
        items={[
          {
            id: "details",
            label: "订单详情",
            icon: "arrow-right",
            onSelect: () =>
              router.push(`/orders/${encodeURIComponent(order.orderNo)}`),
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(order.tenantCode)}`),
          },
          {
            id: "confirm-payment",
            label: "确认收款",
            icon: "check",
            disabled: !canConfirmOrderOfflinePayment(order),
            hint: confirmOfflinePaymentDisabledReason(order) ?? undefined,
            onSelect: () => onConfirmPayment(order),
          },
          {
            id: "subscription",
            label: "查看订阅",
            icon: "star",
            onSelect: () =>
              router.push(
                `/subscriptions/${encodeURIComponent(order.orderNo)}`,
              ),
          },
        ]}
      />
    </div>
  );
}

/**
 * 行内的状态标仍是 pill（`vx-order-pill--*`）而非 `StatusBadge`：那一族是业务
 * 值域着色表，整族改 Badge 归批 4，一次改动不跨两个语义面。
 */
function useOrderColumns(): DataTableColumn<OrderOperationRecord>[] {
  const t = useTranslations();
  const locale = useLocale();
  const tShared = useTranslations();
  const router = useRouter();

  return [
    {
      id: "order",
      header: "订单",
      cell: (order) => (
        <TableTitleCell
          title={order.orderNo}
          description={`${order.billNo ?? "未生成账单"} · ${formatDate(order.createdAt, locale)}`}
          onTitleClick={() =>
            router.push(`/orders/${encodeURIComponent(order.orderNo)}`)
          }
        />
      ),
    },
    {
      id: "tenant",
      header: "租户",
      cell: (order) => (
        <TableTitleCell
          icon={order.tenantType === "company" ? "buildings" : "user"}
          title={order.tenantName}
          description={`${order.tenantCode} · ${typeLabel(order.tenantType)}`}
        />
      ),
    },
    {
      id: "solution",
      header: "业务方案",
      cell: (order) => (
        <TableTitleCell
          /* 缺失值弱化：深色粗体会让"未设置"读起来跟真的方案名一样重。 */
          title={
            isUnset(order.solutionName) ? (
              <span className="text-body-md text-muted-foreground">
                {UNSET_LABEL}
              </span>
            ) : (
              order.solutionName
            )
          }
          description={`${order.industry} · ${order.region}`}
        />
      ),
    },
    {
      id: "plan",
      header: "套餐",
      cell: (order) => (
        <TableTitleCell
          title={
            <span className="inline-flex flex-wrap gap-2xs">
              {isUnset(order.tierName) ? (
                <span className="text-body-md text-muted-foreground">
                  {UNSET_LABEL}
                </span>
              ) : (
                <Badge className={tierBadgeClass(order.tierName)}>
                  {order.tierName}
                </Badge>
              )}
              <StatusBadge tone="neutral" icon={false}>
                {cycleLabel(order.cycleType)}
              </StatusBadge>
            </span>
          }
          description={order.servicePlanName}
        />
      ),
    },
    {
      id: "amount",
      header: "金额",
      align: "right",
      cell: (order) => (
        <TableTitleCell
          title={formatCurrency(order.amount, order.currency)}
          description={`已收 ${formatCurrency(order.paidAmount, order.currency)}`}
        />
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (order) => (
        <TableTitleCell
          title={
            <StatusBadge
              tone={ORDER_STATUS_TONE[order.orderStatus]}
              icon={orderStatusIcon(order.orderStatus)}
            >
              {orderStatusLabel(order.orderStatus)}
            </StatusBadge>
          }
          description={`${t(`status.orderPayment.${order.paymentStatus}`)} · ${paySourceLabel(order.paySource)}`}
        />
      ),
    },
  ];
}

export function OrdersPage() {
  const t = useTranslations();
  const tShared = useTranslations();
  const { runWithStepUp } = useStepUp();
  const [orders, setOrders] = useState<OrderOperationRecord[]>([]);
  const [ordersTruncated, setOrdersTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("all");
  const [paymentFilter, setPaymentFilter] =
    useState<PaymentStatusFilter>("all");
  const [paySourceFilter, setPaySourceFilter] =
    useState<PaySourceFilter>("all");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] =
    useState<OrderOperationRecord | null>(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<string | null>(
    null,
  );
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    fetchOrderOperations()
      .then((records) => {
        if (active) {
          setOrders(records);
          setOrdersTruncated(isListTruncated(records));
        }
      })
      .catch((error) => {
        if (active) {
          setOrders([]);
          setOrdersTruncated(false);
          setLoadError(
            error instanceof Error ? error.message : "订单数据读取失败",
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

  const orderColumns = useOrderColumns();

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return orders
      .filter((order) => {
        if (statusFilter !== "all" && order.orderStatus !== statusFilter)
          return false;
        if (paymentFilter !== "all" && order.paymentStatus !== paymentFilter)
          return false;
        if (paySourceFilter !== "all" && order.paySource !== paySourceFilter)
          return false;
        if (tierFilter !== "all" && tierFilterOf(order.tierName) !== tierFilter)
          return false;
        if (
          normalizedQuery &&
          !orderSearchText(order).includes(normalizedQuery)
        )
          return false;
        return true;
      })
      .sort(
        (a, b) => attentionRank(a.orderStatus) - attentionRank(b.orderStatus),
      );
  }, [orders, paymentFilter, paySourceFilter, query, statusFilter, tierFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleOrders = filteredOrders.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const pendingCount = orders.filter(
    (item) =>
      item.orderStatus === "pending" || item.orderStatus === "pending_verify",
  ).length;
  const confirmedAmount = orders
    .filter((item) => item.orderStatus === "confirmed")
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const overdueCount = orders.filter(
    (item) => item.orderStatus === "overdue",
  ).length;
  const abnormalCount = orders.filter(
    (item) => item.orderStatus === "abnormal",
  ).length;
  const attentionCount = orders.filter(
    (item) =>
      item.orderStatus === "paid_unprovisioned" ||
      item.orderStatus === "partial_pending",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [
    pageSize,
    paymentFilter,
    paySourceFilter,
    query,
    statusFilter,
    tierFilter,
  ]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setPaymentFilter("all");
    setPaySourceFilter("all");
    setTierFilter("all");
  }

  const selectedOrders = useMemo(
    () => orders.filter((order) => selectedOrderIds.has(order.id)),
    [orders, selectedOrderIds],
  );

  function clearOrderSelection() {
    setSelectedOrderIds(new Set());
  }

  function requestConfirmPayment(order: OrderOperationRecord) {
    setOperationError(null);
    setOperationFeedback(null);
    setPaymentTarget(order);
  }

  async function handleConfirmOfflinePayment(
    payload: Parameters<typeof confirmOrderOfflinePayment>[1],
  ) {
    if (!paymentTarget) return;

    setSubmittingPayment(true);
    setOperationError(null);

    try {
      // step-up gated endpoint (@RequireStepUp):必须经 runWithStepUp,否则
      // 首次点击被 403 step_up_required 打回且不弹 TOTP(详情页早已包裹,
      // 本列表页此前漏包——2026-08-20 修)。
      await runWithStepUp(() =>
        confirmOrderOfflinePayment(paymentTarget.id, payload),
      );
      const records = await fetchOrderOperations();
      setOrders(records);
      setOrdersTruncated(isListTruncated(records));
      setOperationFeedback("线下收款已确认。");
      setPaymentTarget(null);
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : "确认线下收款失败，请稍后重试。",
      );
    } finally {
      setSubmittingPayment(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="w-full "
        header={
          <PageHeader
            icon="table"
            eyebrow="订阅交易"
            title="订单管理"
            description="运营侧查看租户订阅订单、账单和收款状态，支撑续期确认、异常处理和财务对账。"
          />
        }
        summary={
          <>
            <MetricGrid
              loading={loading}
              aria-label="订单管理统计"
              items={[
                {
                  id: "total",
                  help: "当前筛选条件下的订单条数。",
                  icon: "table",
                  label: "订单总数",
                  value: formatNumber(orders.length),
                  tags: [`筛选 ${formatNumber(filteredOrders.length)}`],
                },
                {
                  id: "pending",
                  help: "待处理订单：待确认与待核验。",
                  icon: "clock",
                  label: tShared("status.generic.pending"),
                  value: formatNumber(pendingCount),
                  tags: [
                    `待复核 ${formatNumber(orders.filter((item) => item.orderStatus === "pending_verify").length)}`,
                  ],
                  tone: pendingCount ? "warning" : "success",
                },
                {
                  id: "confirmed-amount",
                  help: "已确认订单的已收金额合计。",
                  icon: "chart-bar",
                  label: "已确认金额",
                  value: formatCurrency(confirmedAmount, "CNY"),
                  tags: ["运营口径"],
                  tone: "success",
                },
                {
                  id: "abnormal",
                  help: "需要干预的订单合计：逾期、异常、已付未开通、部分待处理。",
                  icon: "warning",
                  label: "异常逾期",
                  value: formatNumber(
                    overdueCount + abnormalCount + attentionCount,
                  ),
                  tags: [
                    `异常 ${formatNumber(abnormalCount)}`,
                    `付未开通/挂账 ${formatNumber(attentionCount)}`,
                  ],
                  tone:
                    overdueCount || abnormalCount || attentionCount
                      ? "danger"
                      : "success",
                },
              ]}
            />

            {operationFeedback ? (
              <div className="inline-flex w-fit items-center rounded-lg bg-success-muted px-sm py-xs text-body-sm text-success-text">
                {operationFeedback}
              </div>
            ) : null}

            {ordersTruncated ? (
              <Banner
                tone="warning"
                title="当前订单列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标订单，请尝试缩小筛选范围（如按状态、支付方式等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            count={formatNumber(filteredOrders.length)}
            aria-label="订单筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索订单、租户、方案、账单"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索订单"
              />
            }
            onReset={handleReset}
            actions={
              <>
                {/* 导出以选中项为对象：没选就没有导出的对象，选了就是当下要做的事。
                    此前它导出全部筛选结果，与批量条里的"导出所选"是两个入口做同一件事。 */}
                <ActionButton
                  variant={selectedOrderIds.size > 0 ? "default" : "outline"}
                  icon="arrow-down"
                  onClick={() =>
                    exportRowsToCsv(
                      "orders-export",
                      orderCsvColumns(t),
                      selectedOrders,
                    )
                  }
                  disabled={selectedOrderIds.size === 0}
                >
                  {tShared("common.export")}
                </ActionButton>
                <ActionButton icon="plus" disabled>
                  补录订单
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as OrderStatusFilter)
                }
                aria-label="订单状态"
              >
                <option value="all">全部订单</option>
                <option value="pending">待付款</option>
                <option value="pending_verify">待复核</option>
                <option value="confirmed">已确认</option>
                <option value="overdue">
                  {tShared("status.generic.overdue")}
                </option>
                <option value="closed">
                  {tShared("status.generic.closed")}
                </option>
                <option value="abnormal">异常</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={paymentFilter}
                onChange={(event) =>
                  setPaymentFilter(event.target.value as PaymentStatusFilter)
                }
                aria-label="支付状态"
              >
                <option value="all">全部支付</option>
                <option value="not_required">无需支付</option>
                <option value="unpaid">未支付</option>
                <option value="pending">
                  {tShared("status.generic.paying")}
                </option>
                <option value="pending_verify">线下待核</option>
                <option value="paid">已支付</option>
                <option value="partial">部分支付</option>
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
                aria-label="支付来源"
              >
                <option value="all">全部来源</option>
                <option value="online">线上</option>
                <option value="offline">线下</option>
                <option value="none">{tShared("common.none")}</option>
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
        bulkBar={
          selectedOrderIds.size > 0 ? (
            <BulkActionBar
              count={selectedOrderIds.size}
              actions={[
                {
                  id: "export",
                  label: tShared("common.exportSelected"),
                  onSelect: () =>
                    exportRowsToCsv(
                      "orders-export",
                      orderCsvColumns(t),
                      selectedOrders,
                    ),
                },
              ]}
              onClear={clearOrderSelection}
            />
          ) : null
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="订单清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}

            <DataTable
              columns={orderColumns}
              rows={visibleOrders}
              rowKey={(order) => order.id}
              loading={loading}
              indexStart={(activePage - 1) * pageSize + 1}
              selectedKeys={[...selectedOrderIds]}
              onSelectionChange={(keys) => setSelectedOrderIds(new Set(keys))}
              rowActions={(order) => (
                <OrderActionsMenu
                  order={order}
                  onConfirmPayment={requestConfirmPayment}
                />
              )}
              empty={
                <EmptyState
                  title={loadError ? "订单数据读取失败" : "没有匹配的订单"}
                  description={
                    loadError ?? "清空筛选条件后可查看全部订单记录。"
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
            total={filteredOrders.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />
      {paymentTarget ? (
        <OrderOfflinePaymentDialog
          order={paymentTarget}
          busy={submittingPayment}
          error={operationError}
          onCancel={() => {
            if (!submittingPayment) setPaymentTarget(null);
          }}
          onSubmit={handleConfirmOfflinePayment}
        />
      ) : null}
    </>
  );
}
