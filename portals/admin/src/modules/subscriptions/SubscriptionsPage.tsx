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
  ListCardGrid,
  ListPageTemplate,
  MetricGrid,
  MetricListCard,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
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
import {
  fetchSubscriptionOperations,
  submitSubscriptionOperation,
} from "@/api/admin-bff";
import type {
  SubscriptionOperationAction,
  SubscriptionOperationQuotaRisk,
  SubscriptionOperationRecord,
  SubscriptionOperationStatus,
} from "@/entities/console";
import {
  QUOTA_RISK_TONE,
  SUBSCRIPTION_OPERATION_TONE,
} from "@/modules/shared/status-tone";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  canRunSubscriptionAction,
  SubscriptionOperationDialog,
  subscriptionActionDisabledReason,
  subscriptionActionIcon,
  subscriptionActionLabel,
  subscriptionToggleAction,
} from "@/modules/subscriptions/SubscriptionOperationDialog";
import {
  formatDate,
  formatMoney,
  formatNumber,
  typeLabel,
} from "@/modules/tenants/tenant-utils";
import { useConfirmLabels } from "@/modules/shared/destructive";

type ViewMode = "list" | "cards";
type StatusFilter = "all" | SubscriptionOperationStatus;
type TierFilter = "all" | TierFilterValue;
type RiskFilter = "all" | SubscriptionOperationQuotaRisk;
type RenewFilter = "all" | "auto" | "manual";

function subscriptionStatusLabel(status: SubscriptionOperationStatus) {
  if (status === "trialing") return "试用";
  if (status === "active") return "已生效";
  if (status === "expiring") return "即将到期";
  if (status === "overdue") return "逾期";
  if (status === "suspended") return "暂停";
  return "已取消";
}

function subscriptionStatusIcon(status: SubscriptionOperationStatus): IconName {
  if (status === "active") return "check";
  if (status === "trialing" || status === "expiring") return "clock";
  if (status === "cancelled") return "x";
  return "warning";
}

function cycleLabel(cycle: SubscriptionOperationRecord["cycleType"]) {
  if (cycle === "yearly") return "年付";
  if (cycle === "once") return "一次性";
  return "月付";
}

function quotaRiskLabel(risk: SubscriptionOperationQuotaRisk) {
  if (risk === "danger") return "高风险";
  if (risk === "warning") return "需关注";
  return "正常";
}

function subscriptionSearchText(record: SubscriptionOperationRecord) {
  return [
    record.id,
    record.subscriptionCode,
    record.orderNo,
    record.tenantCode,
    record.tenantName,
    record.region,
    record.industry,
    record.solutionName,
    record.servicePlanCode,
    record.servicePlanName,
    record.tierName,
    record.operatorName,
    record.operationHint,
    record.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const SUBSCRIPTION_CSV_COLUMNS: CsvColumn<SubscriptionOperationRecord>[] = [
  { label: "订阅编号", value: (record) => record.subscriptionCode },
  { label: "订单号", value: (record) => record.orderNo ?? "" },
  { label: "租户编号", value: (record) => record.tenantCode },
  { label: "租户名称", value: (record) => record.tenantName },
  { label: "业务方案", value: (record) => record.solutionName },
  { label: "套餐", value: (record) => record.tierName },
  { label: "套餐编码", value: (record) => record.servicePlanCode },
  { label: "周期", value: (record) => cycleLabel(record.cycleType) },
  { label: "状态", value: (record) => subscriptionStatusLabel(record.status) },
  { label: "自动续期", value: (record) => (record.autoRenew ? "是" : "否") },
  { label: "配额使用率", value: (record) => record.quota.usageRate },
  {
    label: "配额风险",
    value: (record) => quotaRiskLabel(record.quota.risk),
  },
  { label: "席位", value: (record) => record.quota.maxUsers },
  { label: "货币", value: (record) => record.currency },
  { label: "支付金额", value: (record) => record.payAmount },
  { label: "月收入", value: (record) => record.monthlyRevenue },
  { label: "开始时间", value: (record) => record.startAt },
  { label: "结束时间", value: (record) => record.endAt ?? "" },
];

function SubscriptionActionsMenu({
  subscription,
  onAction,
}: {
  subscription: SubscriptionOperationRecord;
  onAction: (
    subscription: SubscriptionOperationRecord,
    action: SubscriptionOperationAction,
  ) => void;
}) {
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const router = useRouter();
  const toggleAction = subscriptionToggleAction(subscription.status);

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${subscription.tenantName} 订阅操作`}
        items={[
          {
            id: "details",
            label: tShared("actions.viewDetail"),
            icon: "arrow-right",
            onSelect: () =>
              router.push(
                `/subscriptions/${encodeURIComponent(subscription.id)}`,
              ),
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(
                `/tenants/${encodeURIComponent(subscription.tenantId)}`,
              ),
          },
          {
            id: "plan",
            label: "调整套餐",
            icon: "star",
            disabled: true,
          },
          {
            id: "renew",
            label: subscriptionActionLabel("renew"),
            icon: subscriptionActionIcon("renew"),
            disabled: !canRunSubscriptionAction("renew", subscription),
            hint:
              subscriptionActionDisabledReason("renew", subscription) ??
              undefined,
            onSelect: () => onAction(subscription, "renew"),
          },
          {
            id: toggleAction,
            label: subscriptionActionLabel(toggleAction),
            icon: subscriptionActionIcon(toggleAction),
            disabled: !canRunSubscriptionAction(toggleAction, subscription),
            hint:
              subscriptionActionDisabledReason(toggleAction, subscription) ??
              undefined,
            onSelect: () => onAction(subscription, toggleAction),
          },
          {
            id: "cancel",
            label: subscriptionActionLabel("cancel"),
            icon: subscriptionActionIcon("cancel"),
            disabled: !canRunSubscriptionAction("cancel", subscription),
            hint:
              subscriptionActionDisabledReason("cancel", subscription) ??
              undefined,
            danger: true,
            confirm: withLabels({
              verb: subscriptionActionLabel("cancel"),
              target: `${subscription.tenantName} 的「${subscription.solutionName} · ${subscription.servicePlanName}」订阅`,
              consequence:
                "订阅进入已取消状态，租户随即失去该产品的使用权。已产生的账单与用量记录不受影响；要恢复需要重新开通，价格以届时的挂牌价为准。",
              /* 可用性判据此前只体现在 `disabled` 上——点不开，但说不出为什么。 */
              preconditions: [
                {
                  label:
                    subscriptionActionDisabledReason("cancel", subscription) ??
                    "当前状态允许取消",
                  met: canRunSubscriptionAction("cancel", subscription),
                },
              ],
              onConfirm: () => onAction(subscription, "cancel"),
            }),
          },
        ]}
      />
    </div>
  );
}

/**
 * 行内的状态标仍是 pill（`vx-subscription-pill--*`）而非 `StatusBadge`：那一族是
 * 业务值域着色表，整族改 Badge 归批 4，一次改动不跨两个语义面。
 */
function useSubscriptionColumns(): DataTableColumn<SubscriptionOperationRecord>[] {
  const locale = useLocale();
  const tShared = useTranslations();
  const router = useRouter();

  return [
    {
      id: "tenant",
      header: "租户",
      cell: (subscription) => (
        <TableTitleCell
          icon={subscription.tenantType === "company" ? "buildings" : "user"}
          title={subscription.tenantName}
          description={`${subscription.tenantCode} · ${subscription.region}`}
          onTitleClick={() =>
            router.push(`/subscriptions/${encodeURIComponent(subscription.id)}`)
          }
        />
      ),
    },
    {
      id: "solution",
      header: "业务方案",
      cell: (subscription) => (
        <TableTitleCell
          title={subscription.solutionName}
          description={subscription.industry}
        />
      ),
    },
    {
      id: "plan",
      header: "套餐权益",
      cell: (subscription) => (
        <TableTitleCell
          title={
            <span className="inline-flex flex-wrap gap-2xs">
              <Badge className={tierBadgeClass(subscription.tierCode)}>
                {subscription.tierName}
              </Badge>
              <StatusBadge tone="neutral" icon={false}>
                {cycleLabel(subscription.cycleType)}
              </StatusBadge>
            </span>
          }
          description={subscription.orderNo ?? subscription.subscriptionCode}
        />
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (subscription) => (
        <TableTitleCell
          title={
            <StatusBadge
              tone={SUBSCRIPTION_OPERATION_TONE[subscription.status]}
              icon={subscriptionStatusIcon(subscription.status)}
            >
              {subscriptionStatusLabel(subscription.status)}
            </StatusBadge>
          }
          description={`${formatDate(subscription.startAt, locale)} - ${formatDate(subscription.endAt, locale)}`}
        />
      ),
    },
    {
      id: "quota",
      header: "配额",
      align: "right",
      cell: (subscription) => (
        <TableTitleCell
          title={`${formatNumber(subscription.quota.usageRate)}%`}
          description={`${quotaRiskLabel(subscription.quota.risk)} · ${formatNumber(subscription.quota.maxUsers)} 席位`}
        />
      ),
    },
    {
      id: "revenue",
      header: "收入",
      align: "right",
      cell: (subscription) => (
        <TableTitleCell
          title={formatMoney(subscription.monthlyRevenue)}
          description={
            subscription.autoRenew ? "自动续期" : subscription.operationHint
          }
        />
      ),
    },
  ];
}

function SubscriptionCards({
  subscriptions,
  onAction,
}: {
  subscriptions: SubscriptionOperationRecord[];
  onAction: (
    subscription: SubscriptionOperationRecord,
    action: SubscriptionOperationAction,
  ) => void;
}) {
  const locale = useLocale();
  const router = useRouter();

  return (
    <ListCardGrid aria-label="租户订阅运营卡片">
      {subscriptions.map((subscription) => (
        <MetricListCard
          key={subscription.id}
          icon={subscription.tenantType === "company" ? "buildings" : "user"}
          title={subscription.tenantName}
          description={`${subscription.tenantCode} · ${typeLabel(subscription.tenantType)}`}
          tone={SUBSCRIPTION_OPERATION_TONE[subscription.status]}
          actions={
            <SubscriptionActionsMenu
              subscription={subscription}
              onAction={onAction}
            />
          }
          badges={
            <>
              <StatusBadge
                tone={SUBSCRIPTION_OPERATION_TONE[subscription.status]}
              >
                {subscriptionStatusLabel(subscription.status)}
              </StatusBadge>
              <Badge className={tierBadgeClass(subscription.tierCode)}>
                {subscription.tierName}
              </Badge>
              <StatusBadge tone={QUOTA_RISK_TONE[subscription.quota.risk]}>
                {quotaRiskLabel(subscription.quota.risk)}
              </StatusBadge>
            </>
          }
          note={`${subscription.solutionName} · ${subscription.servicePlanName}`}
          metrics={[
            {
              key: "quota",
              value: `${formatNumber(subscription.quota.usageRate)}%`,
              label: "配额消耗",
            },
            {
              key: "seats",
              value: formatNumber(subscription.quota.maxUsers),
              label: "席位",
            },
            {
              key: "revenue",
              value: formatMoney(subscription.monthlyRevenue),
              label: "月收入",
            },
          ]}
          footer={
            <>
              <span>{subscription.operationHint}</span>
              <strong>
                {formatDate(subscription.startAt, locale)} -{" "}
                {formatDate(subscription.endAt, locale)}
              </strong>
            </>
          }
          onClick={() =>
            router.push(`/subscriptions/${encodeURIComponent(subscription.id)}`)
          }
        />
      ))}
    </ListCardGrid>
  );
}

export function SubscriptionsPage() {
  const tShared = useTranslations();
  const [subscriptions, setSubscriptions] = useState<
    SubscriptionOperationRecord[]
  >([]);
  const [subscriptionsTruncated, setSubscriptionsTruncated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedSubscriptionIds, setSelectedSubscriptionIds] = useState<
    Set<string>
  >(() => new Set());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [renewFilter, setRenewFilter] = useState<RenewFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<{
    subscription: SubscriptionOperationRecord;
    action: SubscriptionOperationAction;
  } | null>(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    fetchSubscriptionOperations()
      .then((records) => {
        if (active) {
          setSubscriptions(records);
          setSubscriptionsTruncated(isListTruncated(records));
        }
      })
      .catch((error) => {
        if (active) {
          setSubscriptions([]);
          setSubscriptionsTruncated(false);
          setLoadError(
            error instanceof Error ? error.message : "订阅数据读取失败",
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

  const subscriptionColumns = useSubscriptionColumns();

  const filteredSubscriptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return subscriptions.filter((subscription) => {
      if (statusFilter !== "all" && subscription.status !== statusFilter)
        return false;
      if (
        tierFilter !== "all" &&
        tierFilterOf(subscription.tierName) !== tierFilter
      )
        return false;
      if (riskFilter !== "all" && subscription.quota.risk !== riskFilter)
        return false;
      if (renewFilter === "auto" && !subscription.autoRenew) return false;
      if (renewFilter === "manual" && subscription.autoRenew) return false;
      if (
        normalizedQuery &&
        !subscriptionSearchText(subscription).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [query, renewFilter, riskFilter, statusFilter, subscriptions, tierFilter]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredSubscriptions.length / pageSize),
  );
  const activePage = Math.min(currentPage, pageCount);
  const visibleSubscriptions = filteredSubscriptions.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const effectiveCount = subscriptions.filter(
    (item) => item.status === "active" || item.status === "expiring",
  ).length;
  const followUpCount = subscriptions.filter(
    (item) =>
      item.status === "trialing" ||
      item.status === "expiring" ||
      item.status === "overdue" ||
      item.quota.risk !== "normal",
  ).length;
  const dangerQuotaCount = subscriptions.filter(
    (item) => item.quota.risk === "danger",
  ).length;
  const warningQuotaCount = subscriptions.filter(
    (item) => item.quota.risk === "warning",
  ).length;
  const monthlyRevenue = subscriptions.reduce(
    (sum, item) => sum + item.monthlyRevenue,
    0,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [
    pageSize,
    query,
    renewFilter,
    riskFilter,
    statusFilter,
    tierFilter,
    viewMode,
  ]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setTierFilter("all");
    setRiskFilter("all");
    setRenewFilter("all");
  }

  function requestSubscriptionAction(
    subscription: SubscriptionOperationRecord,
    action: SubscriptionOperationAction,
  ) {
    setOperationError(null);
    setOperationFeedback(null);
    setActionTarget({ subscription, action });
  }

  const selectedSubscriptions = subscriptions.filter((subscription) =>
    selectedSubscriptionIds.has(subscription.id),
  );

  function clearSubscriptionSelection() {
    setSelectedSubscriptionIds(new Set());
  }

  function handleExportSelectedSubscriptions() {
    exportRowsToCsv(
      "subscriptions-export",
      SUBSCRIPTION_CSV_COLUMNS,
      selectedSubscriptions,
    );
  }

  async function handleSubmitSubscriptionAction(reason: string) {
    if (!actionTarget) return;

    setSubmittingAction(true);
    setOperationError(null);

    try {
      await submitSubscriptionOperation(actionTarget.subscription.id, {
        action: actionTarget.action,
        reason,
      });
      const records = await fetchSubscriptionOperations();
      setSubscriptions(records);
      setSubscriptionsTruncated(isListTruncated(records));
      setOperationFeedback(
        `${subscriptionActionLabel(actionTarget.action)}已完成。`,
      );
      setActionTarget(null);
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "订阅操作失败，请稍后重试。",
      );
    } finally {
      setSubmittingAction(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-subscriptions-page"
        header={
          <PageHeader
            icon="star"
            eyebrow="订阅交易"
            title="租户订阅运营"
            description="运营侧管理租户服务权益实例，跟进试用转正、续期、暂停、配额风险和收入状态。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="租户订阅运营统计"
              items={[
                {
                  id: "instances",
                  help: "当前筛选条件下的订阅实例数。",
                  icon: "star",
                  label: "订阅实例",
                  value: formatNumber(subscriptions.length),
                  tags: [`有效 ${formatNumber(effectiveCount)}`],
                },
                {
                  id: "follow-up",
                  help: "需跟进的订阅：试用、即将到期、欠费，或配额风险非正常。",
                  icon: "warning",
                  label: "待跟进",
                  value: formatNumber(followUpCount),
                  tags: [
                    `逾期 ${formatNumber(subscriptions.filter((item) => item.status === "overdue").length)}`,
                  ],
                  tone: followUpCount ? "warning" : "success",
                },
                {
                  id: "monthly-revenue",
                  help: "这些订阅的月收入之和；年付按 12 个月折算，一次性买断计 0。",
                  icon: "chart-bar",
                  label: "月收入",
                  value: formatMoney(monthlyRevenue),
                  tags: ["运营口径"],
                  tone: "success",
                },
                {
                  id: "quota-risk",
                  help: "配额风险为危险或警告的订阅数。",
                  icon: "shield-check",
                  label: "配额风险",
                  value: formatNumber(dangerQuotaCount + warningQuotaCount),
                  tags: [`高风险 ${formatNumber(dangerQuotaCount)}`],
                  tone: dangerQuotaCount
                    ? "danger"
                    : warningQuotaCount
                      ? "warning"
                      : "success",
                },
              ]}
            />
            {operationFeedback ? (
              <div className="vx-subscription-operation-feedback">
                {operationFeedback}
              </div>
            ) : null}
            {subscriptionsTruncated ? (
              <Banner
                tone="warning"
                title="当前订阅列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标订阅，请尝试缩小筛选范围（如按状态、套餐等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredSubscriptions.length)}
            aria-label="租户订阅筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索租户、方案、套餐、订单"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索租户订阅"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton
                  variant={
                    selectedSubscriptions.length > 0 ? "default" : "outline"
                  }
                  icon="arrow-down"
                  onClick={handleExportSelectedSubscriptions}
                  disabled={selectedSubscriptions.length === 0}
                >
                  {tShared("common.export")}
                </ActionButton>
                <ActionButton variant="outline" icon="plus" disabled>
                  开通订阅
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="订阅状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="trialing">
                  {tShared("status.generic.trial")}
                </option>
                <option value="active">已生效</option>
                <option value="expiring">即将到期</option>
                <option value="overdue">
                  {tShared("status.generic.overdue")}
                </option>
                <option value="suspended">{tShared("actions.pause")}</option>
                <option value="cancelled">已取消</option>
              </NativeSelect>
              <NativeSelect
                className="w-fit basis-media-xl"
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
              <NativeSelect
                className="w-fit basis-media-xl"
                value={riskFilter}
                onChange={(event) =>
                  setRiskFilter(event.target.value as RiskFilter)
                }
                aria-label="配额风险"
              >
                <option value="all">全部配额</option>
                <option value="normal">
                  {tShared("status.generic.normal")}
                </option>
                <option value="warning">需关注</option>
                <option value="danger">高风险</option>
              </NativeSelect>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={renewFilter}
                onChange={(event) =>
                  setRenewFilter(event.target.value as RenewFilter)
                }
                aria-label="续期方式"
              >
                <option value="all">全部续期</option>
                <option value="auto">自动续期</option>
                <option value="manual">人工跟进</option>
              </NativeSelect>
            </>
          </FilterBar>
        }
        bulkBar={
          selectedSubscriptions.length ? (
            <BulkActionBar
              count={selectedSubscriptions.length}
              actions={[
                {
                  id: "export",
                  label: tShared("common.exportSelected"),
                  onSelect: handleExportSelectedSubscriptions,
                },
              ]}
              onClear={clearSubscriptionSelection}
            />
          ) : null
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="租户订阅清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={subscriptionColumns}
                rows={visibleSubscriptions}
                rowKey={(subscription) => subscription.id}
                loading={loading}
                indexStart={(activePage - 1) * pageSize + 1}
                selectedKeys={[...selectedSubscriptionIds]}
                onSelectionChange={(keys) =>
                  setSelectedSubscriptionIds(new Set(keys))
                }
                rowActions={(subscription) => (
                  <SubscriptionActionsMenu
                    subscription={subscription}
                    onAction={requestSubscriptionAction}
                  />
                )}
                empty={
                  <EmptyState
                    title={loadError ? "订阅数据读取失败" : "没有匹配的订阅"}
                    description={
                      loadError ?? "清空筛选条件后可查看全部订阅实例。"
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
            ) : visibleSubscriptions.length ? (
              <SubscriptionCards
                subscriptions={visibleSubscriptions}
                onAction={requestSubscriptionAction}
              />
            ) : (
              <EmptyState
                title={loading ? "正在加载租户订阅" : "没有匹配的订阅"}
                description={
                  loading
                    ? "正在读取租户订阅运营数据。"
                    : (loadError ?? "清空筛选条件后可查看全部订阅实例。")
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
            total={filteredSubscriptions.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />

      {actionTarget ? (
        <SubscriptionOperationDialog
          action={actionTarget.action}
          subscriptionName={`${actionTarget.subscription.tenantName} / ${actionTarget.subscription.tierName}`}
          busy={submittingAction}
          error={operationError}
          onCancel={() => {
            if (!submittingAction) setActionTarget(null);
          }}
          onSubmit={handleSubmitSubscriptionAction}
        />
      ) : null}
    </>
  );
}
