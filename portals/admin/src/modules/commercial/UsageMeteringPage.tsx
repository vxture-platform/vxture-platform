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
  Icon,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { fetchUsageMeteringRecords } from "@/api/admin-bff";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { isListTruncated } from "@/lib/list-truncation";
import type {
  UsageMeteringRecord,
  UsageMeteringRisk,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import {
  formatDate,
  formatNumber,
  joinClasses,
  typeLabel,
} from "@/modules/tenants/tenant-utils";
import {
  formatPercent,
  type PageSize,
  Tag,
  type ViewMode,
} from "./CommercialUtils";

type RiskFilter = "all" | UsageMeteringRisk;
type ProductTypeFilter =
  | "all"
  | "智能体"
  | "平台"
  | "大模型"
  | "三方接入"
  | "产品能力";
type CycleFilter = "all" | string;

function riskLabel(risk: UsageMeteringRisk) {
  if (risk === "danger") return "超额";
  if (risk === "warning") return "接近上限";
  if (risk === "anomaly") return "计量异常";
  return "正常";
}

function riskTone(risk: UsageMeteringRisk) {
  if (risk === "normal") return "normal";
  if (risk === "warning") return "warning";
  return "danger";
}

function usageSearchText(record: UsageMeteringRecord) {
  return [
    record.tenantCode,
    record.tenantName,
    record.region,
    record.industry,
    record.orderNo,
    record.servicePlanName,
    record.productCode,
    record.productName,
    record.productType,
    record.metricCode,
    record.metricName,
    riskLabel(record.risk),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatUsageValue(value: number, unit: string) {
  if (unit === "token" || unit === "字") return formatNumber(value);
  return `${formatNumber(value)} ${unit}`;
}

const USAGE_CSV_COLUMNS: CsvColumn<UsageMeteringRecord>[] = [
  { label: "租户编号", value: (record) => record.tenantCode },
  { label: "租户名称", value: (record) => record.tenantName },
  { label: "产品编码", value: (record) => record.productCode },
  { label: "产品名称", value: (record) => record.productName },
  { label: "产品类型", value: (record) => record.productType },
  { label: "计量项", value: (record) => record.metricName },
  { label: "计量编码", value: (record) => record.metricCode },
  { label: "单位", value: (record) => record.metricUnit },
  { label: "已用量", value: (record) => record.usedValue },
  { label: "配额", value: (record) => record.quotaValue },
  { label: "使用率", value: (record) => record.usageRate },
  { label: "周期", value: (record) => record.cycleMonth },
  { label: "风险", value: (record) => riskLabel(record.risk) },
  { label: "最近同步", value: (record) => record.lastSyncedAt },
];

function UsageActionsMenu({ record }: { record: UsageMeteringRecord }) {
  const tShared = useTranslations();
  const router = useRouter();

  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${record.tenantName} 用量操作`}
        items={[
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(record.tenantId)}`),
          },
          {
            id: "subscription",
            label: "查看订阅",
            icon: "star",
            disabled: !record.subscriptionId,
            onSelect: () => {
              if (!record.subscriptionId) return;
              router.push(
                `/subscriptions/${encodeURIComponent(record.subscriptionId)}`,
              );
            },
          },
          {
            id: "order",
            label: "查看订单",
            icon: "table",
            disabled: !record.subscriptionId,
            onSelect: () => {
              if (!record.subscriptionId) return;
              router.push(
                `/orders/${encodeURIComponent(record.subscriptionId)}`,
              );
            },
          },
        ]}
      />
    </div>
  );
}

/** 这一页的风险标已经是 DS `Tag`，不带业务色类，与批 4 无关。 */
function useUsageColumns(): DataTableColumn<UsageMeteringRecord>[] {
  const locale = useLocale();
  const router = useRouter();

  return [
    {
      id: "tenant",
      header: "租户",
      cell: (record) => (
        <TableTitleCell
          icon={record.tenantType === "company" ? "buildings" : "user"}
          title={record.tenantName}
          description={`${record.tenantCode} · ${typeLabel(record.tenantType)}`}
          onTitleClick={() =>
            router.push(`/tenants/${encodeURIComponent(record.tenantId)}`)
          }
        />
      ),
    },
    {
      id: "product",
      header: "产品能力",
      cell: (record) => (
        <TableTitleCell
          title={record.productName}
          description={`${record.productType} · ${record.productCode}`}
        />
      ),
    },
    {
      id: "metric",
      header: "计量项",
      cell: (record) => (
        <TableTitleCell
          // 单位可缺（BFF 对没有单位的计量项回空串）。空标会渲染成一个什么都
          // 不写的小圆圈，比不画更难读，所以缺就不画。
          title={
            record.metricUnit ? (
              <Badge variant="outline">{record.metricUnit}</Badge>
            ) : null
          }
          description={record.metricName}
        />
      ),
    },
    {
      id: "usage",
      header: "用量",
      align: "right",
      cell: (record) => (
        <TableTitleCell
          title={formatUsageValue(record.usedValue, record.metricUnit)}
          description={`配额 ${formatUsageValue(record.quotaValue, record.metricUnit)} · ${formatPercent(record.usageRate)}`}
        />
      ),
    },
    {
      id: "risk",
      header: "风险",
      align: "center",
      // 图标由 `Tag` 内的 `StatusBadge` 按语气自带。此前 `Tag` 只出朴素 Badge，
      // 图标才并排挂在外面；`Tag` 改出 StatusBadge 之后那个外挂图标就成了第二个勾。
      cell: (record) => (
        <Tag tone={riskTone(record.risk)}>{riskLabel(record.risk)}</Tag>
      ),
    },
    {
      id: "cycle",
      header: "周期",
      align: "center",
      cell: (record) => (
        <TableTitleCell
          title={record.cycleMonth}
          description={formatDate(record.lastSyncedAt, locale)}
        />
      ),
    },
  ];
}

function UsageCards({ records }: { records: UsageMeteringRecord[] }) {
  const locale = useLocale();
  const router = useRouter();

  return (
    <div
      className="vx-tenant-directory-cards vx-commercial-cards"
      aria-label="用量计费卡片"
    >
      {records.map((record) => (
        <article
          key={record.id}
          className={joinClasses(
            "vx-tenant-directory-card",
            `vx-commercial-card--${riskTone(record.risk)}`,
          )}
          role="button"
          tabIndex={0}
          onClick={() =>
            router.push(`/tenants/${encodeURIComponent(record.tenantId)}`)
          }
        >
          <header>
            <Icon name="graph" size="lg" fallback="placeholder" />
            <div>
              <strong>{record.tenantName}</strong>
              <span>
                {record.productName} · {record.metricName}
              </span>
            </div>
            <UsageActionsMenu record={record} />
          </header>
          <div className="vx-tenant-directory-card__badges">
            <Tag tone={riskTone(record.risk)}>{riskLabel(record.risk)}</Tag>
            <Badge variant="outline">{record.productType}</Badge>
          </div>
          <p className="vx-commercial-card__description">
            {record.servicePlanName ?? record.orderNo ?? "未关联订阅"}
          </p>
          <div className="vx-tenant-directory-card__metrics">
            <span>
              <b>{formatUsageValue(record.usedValue, record.metricUnit)}</b>
              <small>已用</small>
            </span>
            <span>
              <b>{formatUsageValue(record.quotaValue, record.metricUnit)}</b>
              <small>配额</small>
            </span>
            <span>
              <b>{formatPercent(record.usageRate)}</b>
              <small>使用率</small>
            </span>
          </div>
          <footer>
            <span>{record.cycleMonth}</span>
            <strong>{formatDate(record.lastSyncedAt, locale)}</strong>
          </footer>
        </article>
      ))}
    </div>
  );
}

export function UsageMeteringPage() {
  const tShared = useTranslations();
  const [records, setRecords] = useState<UsageMeteringRecord[]>([]);
  const [recordsTruncated, setRecordsTruncated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [productTypeFilter, setProductTypeFilter] =
    useState<ProductTypeFilter>("all");
  const [cycleFilter, setCycleFilter] = useState<CycleFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    fetchUsageMeteringRecords()
      .then((items) => {
        if (active) {
          setRecords(items);
          setRecordsTruncated(isListTruncated(items));
        }
      })
      .catch((error) => {
        if (active) {
          setRecords([]);
          setRecordsTruncated(false);
          setLoadError(
            error instanceof Error ? error.message : "用量数据读取失败",
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

  const cycles = useMemo(
    () =>
      Array.from(new Set(records.map((record) => record.cycleMonth)))
        .sort()
        .reverse(),
    [records],
  );
  const usageColumns = useUsageColumns();

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (riskFilter !== "all" && record.risk !== riskFilter) return false;
      if (
        productTypeFilter !== "all" &&
        record.productType !== productTypeFilter
      )
        return false;
      if (cycleFilter !== "all" && record.cycleMonth !== cycleFilter)
        return false;
      if (normalizedQuery && !usageSearchText(record).includes(normalizedQuery))
        return false;
      return true;
    });
  }, [cycleFilter, productTypeFilter, query, records, riskFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleRecords = filteredRecords.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const totalUsed = records.reduce((sum, record) => sum + record.usedValue, 0);
  const warningCount = records.filter(
    (record) => record.risk === "warning",
  ).length;
  const dangerCount = records.filter(
    (record) => record.risk === "danger" || record.risk === "anomaly",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [cycleFilter, pageSize, productTypeFilter, query, riskFilter, viewMode]);

  function handleReset() {
    setQuery("");
    setRiskFilter("all");
    setProductTypeFilter("all");
    setCycleFilter("all");
  }

  const selectedRecords = records.filter((record) =>
    selectedRecordIds.has(record.id),
  );

  function clearRecordSelection() {
    setSelectedRecordIds(new Set());
  }

  function handleExportSelected() {
    exportRowsToCsv(
      "usage-metering-export",
      USAGE_CSV_COLUMNS,
      selectedRecords,
    );
  }

  function handleExportAll() {
    exportRowsToCsv(
      "usage-metering-export",
      USAGE_CSV_COLUMNS,
      filteredRecords,
    );
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-usage-page"
        header={
          <PageHeader
            icon="graph"
            eyebrow="订阅交易"
            title="用量计费"
            description="运营侧查看租户、订阅、产品能力维度的计量消耗、配额使用率和超额风险。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="用量计费统计"
              items={[
                {
                  id: "records",
                  help: "当前筛选条件下的用量计量记录条数。",
                  icon: "graph",
                  label: "计量记录",
                  value: formatNumber(records.length),
                  tags: [`筛选 ${formatNumber(filteredRecords.length)}`],
                },
                {
                  id: "total-used",
                  help: "这些记录的用量合计，单位随计量项。",
                  icon: "chart-bar",
                  label: "总消耗",
                  value: formatNumber(totalUsed),
                  tags: [`计量项 ${formatNumber(records.length)}`],
                  tone: "success",
                },
                {
                  id: "near-limit",
                  help: "用量风险为警告的记录，接近配额上限。",
                  icon: "clock",
                  label: "接近上限",
                  value: formatNumber(warningCount),
                  tags: [">=85%"],
                  tone: warningCount ? "warning" : "success",
                },
                {
                  id: "over-limit",
                  help: "用量风险为危险或异常的记录，含已超额。",
                  icon: "warning",
                  label: "超额异常",
                  value: formatNumber(dangerCount),
                  tags: [">100% / 异常"],
                  tone: dangerCount ? "danger" : "success",
                },
              ]}
            />
            {recordsTruncated ? (
              <Banner
                tone="warning"
                title="当前用量列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标记录，请尝试缩小筛选范围（如按风险、产品类型、周期等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredRecords.length)}
            aria-label="用量筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索租户、产品、计量项"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索用量"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton
                  variant="outline"
                  icon="arrow-down"
                  onClick={handleExportAll}
                  disabled={!filteredRecords.length}
                >
                  导出全部
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={riskFilter}
                onChange={(event) =>
                  setRiskFilter(event.target.value as RiskFilter)
                }
                aria-label="风险状态"
              >
                <option value="all">全部风险</option>
                <option value="normal">
                  {tShared("status.generic.normal")}
                </option>
                <option value="warning">接近上限</option>
                <option value="danger">超额</option>
                <option value="anomaly">计量异常</option>
              </NativeSelect>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={productTypeFilter}
                onChange={(event) =>
                  setProductTypeFilter(event.target.value as ProductTypeFilter)
                }
                aria-label="产品类型"
              >
                <option value="all">全部产品</option>
                <option value="智能体">智能体</option>
                <option value="平台">平台</option>
                <option value="大模型">大模型</option>
                <option value="三方接入">三方接入</option>
                <option value="产品能力">产品能力</option>
              </NativeSelect>
              <NativeSelect
                className="w-fit basis-media-xl"
                value={cycleFilter}
                onChange={(event) => setCycleFilter(event.target.value)}
                aria-label="计量周期"
              >
                <option value="all">全部周期</option>
                {cycles.map((cycle) => (
                  <option key={cycle} value={cycle}>
                    {cycle}
                  </option>
                ))}
              </NativeSelect>
            </>
          </FilterBar>
        }
        bulkBar={
          selectedRecords.length ? (
            <BulkActionBar
              count={selectedRecords.length}
              actions={[
                {
                  id: "export",
                  label: tShared("common.exportSelected"),
                  onSelect: handleExportSelected,
                },
              ]}
              onClear={clearRecordSelection}
            />
          ) : null
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="用量清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="vx-tenant-directory__header">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}
            {viewMode === "list" ? (
              <DataTable
                columns={usageColumns}
                rows={visibleRecords}
                rowKey={(record) => record.id}
                loading={loading}
                indexStart={(activePage - 1) * pageSize + 1}
                selectedKeys={[...selectedRecordIds]}
                onSelectionChange={(keys) =>
                  setSelectedRecordIds(new Set(keys))
                }
                rowActions={(record) => <UsageActionsMenu record={record} />}
                empty={
                  <EmptyState
                    title={
                      loadError ? "用量数据读取失败" : "没有匹配的用量记录"
                    }
                    description={
                      loadError ?? "清空筛选条件后可查看全部计量记录。"
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
            ) : visibleRecords.length ? (
              <UsageCards records={visibleRecords} />
            ) : (
              <EmptyState
                title={loading ? "正在加载用量" : "没有匹配的用量记录"}
                description={
                  loading
                    ? "正在读取计量汇总数据。"
                    : (loadError ?? "清空筛选条件后可查看全部计量记录。")
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
            total={filteredRecords.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={setCurrentPage}
          />
        }
      />
    </>
  );
}
