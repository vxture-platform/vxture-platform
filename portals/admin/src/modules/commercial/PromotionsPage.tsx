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
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import {
  assignVouchers,
  createVoucherBatch,
  fetchPromotionOperations,
} from "@/api/admin-bff";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";
import {
  AssignVouchersDialog,
  CreateVoucherBatchDialog,
  type CreateBatchPayload,
} from "@/modules/commercial/VoucherBatchDialogs";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { isListTruncated } from "@/lib/list-truncation";
import type {
  PromotionOperationRecord,
  PromotionOperationStatus,
  PromotionOperationType,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";
import { Tag, type PageSize } from "./CommercialUtils";

type StatusFilter = "all" | PromotionOperationStatus;
type TypeFilter = "all" | PromotionOperationType;

function statusLabel(status: PromotionOperationStatus) {
  if (status === "scheduled") return "待开始";
  if (status === "expired") return "已结束";
  if (status === "paused") return "已暂停";
  return "生效中";
}

function typeLabel(type: PromotionOperationType) {
  if (type === "discount") return "套餐折扣";
  if (type === "coupon") return "优惠码";
  return "活动";
}

function statusTone(status: PromotionOperationStatus) {
  if (status === "active") return "normal";
  if (status === "scheduled") return "warning";
  if (status === "paused") return "muted";
  return "danger";
}

function promotionSearchText(record: PromotionOperationRecord) {
  return [
    record.promotionCode,
    record.promotionName,
    record.scopeLabel,
    record.discountLabel,
    record.ownerName,
    record.description,
    statusLabel(record.status),
    typeLabel(record.promotionType),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function promotionCsvColumns(
  locale: string,
): CsvColumn<PromotionOperationRecord>[] {
  return [
    { label: "优惠编号", value: (record) => record.promotionCode },
    { label: "优惠名称", value: (record) => record.promotionName },
    { label: "类型", value: (record) => typeLabel(record.promotionType) },
    { label: "状态", value: (record) => statusLabel(record.status) },
    { label: "适用范围", value: (record) => record.scopeLabel },
    { label: "优惠", value: (record) => record.discountLabel },
    { label: "核销次数", value: (record) => record.redemptionCount },
    { label: "租户数", value: (record) => record.tenantCount },
    { label: "负责人", value: (record) => record.ownerName },
    {
      label: "开始时间",
      value: (record) => formatDate(record.startsAt, locale),
    },
    {
      label: "结束时间",
      value: (record) =>
        record.endsAt ? formatDate(record.endsAt, locale) : "长期",
    },
  ];
}

function PromotionActionsMenu({
  record,
}: {
  record: PromotionOperationRecord;
}) {
  const router = useRouter();

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${record.promotionName} 操作`}
        items={[
          {
            id: "redemptions",
            label: "查看核销",
            icon: "check",
            onSelect: () => router.push("/promotion-redemptions"),
          },
          {
            id: "service-plans",
            label: "服务套餐",
            icon: "star",
            onSelect: () => router.push("/service-plans"),
          },
        ]}
      />
    </div>
  );
}

/** 这一页的标已经是 DS `Tag`，不带业务色类，与批 4 无关。 */
function usePromotionColumns(): DataTableColumn<PromotionOperationRecord>[] {
  const locale = useLocale();
  const tShared = useTranslations();
  const router = useRouter();

  return [
    {
      id: "promotion",
      header: "优惠活动",
      cell: (record) => (
        <TableTitleCell
          title={record.promotionName}
          description={`${record.promotionCode} · ${typeLabel(record.promotionType)}`}
          onTitleClick={() => router.push("/promotion-redemptions")}
        />
      ),
    },
    {
      id: "scope",
      header: "适用范围",
      cell: (record) => (
        <TableTitleCell
          title={<Badge variant="outline">{record.scopeLabel}</Badge>}
          description={record.description}
        />
      ),
    },
    {
      id: "discount",
      header: "优惠",
      align: "center",
      cell: (record) => (
        <TableTitleCell
          title={record.discountLabel}
          description={typeLabel(record.promotionType)}
        />
      ),
    },
    {
      id: "redemption",
      header: "核销",
      align: "right",
      cell: (record) => (
        <TableTitleCell
          title={formatNumber(record.redemptionCount)}
          description={`${formatNumber(record.tenantCount)} 租户`}
        />
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (record) => (
        <TableTitleCell
          title={
            <Tag tone={statusTone(record.status)}>
              {statusLabel(record.status)}
            </Tag>
          }
          description={record.ownerName}
        />
      ),
    },
    {
      id: "time",
      header: "时间",
      align: "center",
      cell: (record) => (
        <TableTitleCell
          title={formatDate(record.startsAt, locale)}
          description={
            record.endsAt ? formatDate(record.endsAt, locale) : "长期"
          }
        />
      ),
    },
  ];
}

export function PromotionsPage() {
  const locale = useLocale();
  const tShared = useTranslations();
  const [records, setRecords] = useState<PromotionOperationRecord[]>([]);
  const [recordsTruncated, setRecordsTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(
    () => new Set(),
  );
  // 发券写动作（product_321 PR5）：批次创建 / 定向发放，两者均 step-up。
  const { runWithStepUp } = useStepUp();
  const [createOpen, setCreateOpen] = useState(false);
  const [assignTarget, setAssignTarget] =
    useState<PromotionOperationRecord | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [assignedCodes, setAssignedCodes] = useState<string[] | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    fetchPromotionOperations()
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
            error instanceof Error ? error.message : "优惠数据读取失败",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadNonce]);

  async function handleCreateBatch(payload: CreateBatchPayload) {
    setWriteBusy(true);
    setWriteError(null);
    try {
      await runWithStepUp(() => createVoucherBatch(payload));
      setCreateOpen(false);
      setReloadNonce((n) => n + 1);
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setWriteError(
        error instanceof Error ? error.message : "批次创建失败，请稍后重试。",
      );
    } finally {
      setWriteBusy(false);
    }
  }

  async function handleAssign(payload: {
    batchId: string;
    count: number;
    targetUserId?: string;
    targetWorkspaceId?: string;
  }) {
    setWriteBusy(true);
    setWriteError(null);
    try {
      const result = await runWithStepUp(() => assignVouchers(payload));
      setAssignedCodes(result.codes);
      setReloadNonce((n) => n + 1);
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setWriteError(
        error instanceof Error ? error.message : "券码发放失败，请稍后重试。",
      );
    } finally {
      setWriteBusy(false);
    }
  }

  const promotionColumns = usePromotionColumns();

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (statusFilter !== "all" && record.status !== statusFilter)
        return false;
      if (typeFilter !== "all" && record.promotionType !== typeFilter)
        return false;
      if (
        normalizedQuery &&
        !promotionSearchText(record).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [query, records, statusFilter, typeFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleRecords = filteredRecords.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const activeCount = records.filter(
    (record) => record.status === "active",
  ).length;
  const redemptionCount = records.reduce(
    (sum, record) => sum + record.redemptionCount,
    0,
  );
  const tenantReach = records.reduce(
    (sum, record) => sum + record.tenantCount,
    0,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, statusFilter, typeFilter]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setTypeFilter("all");
  }

  const selectedRecords = records.filter((record) =>
    selectedRecordIds.has(record.id),
  );

  function handleExportSelected() {
    exportRowsToCsv(
      "promotions-export",
      promotionCsvColumns(locale),
      selectedRecords,
    );
  }

  function handleExportAll() {
    exportRowsToCsv(
      "promotions-export",
      promotionCsvColumns(locale),
      filteredRecords,
    );
  }

  function handleClearSelection() {
    setSelectedRecordIds(new Set());
  }

  return (
    <>
      <ListPageTemplate
        className="w-full vx-promotions-page"
        header={
          <PageHeader
            icon="sparkles"
            eyebrow="产品体系"
            title="营销优惠"
            description="市场运营侧查看卡券批次、发放与核销台账（批次/发码/核销数据来自 promotion 域）。券面金额按 kind 存于 effect JSONB，暂不在本台账展示（见 TD-030）。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="营销优惠统计"
              items={[
                {
                  id: "promotions",
                  help: "当前筛选条件下的优惠活动数。",
                  icon: "sparkles",
                  label: "优惠活动",
                  value: formatNumber(records.length),
                  tags: [`生效 ${formatNumber(activeCount)}`],
                },
                {
                  id: "redemptions",
                  help: "这些活动的核销次数合计。",
                  icon: "check",
                  label: "核销次数",
                  value: formatNumber(redemptionCount),
                  tags: [`筛选 ${formatNumber(filteredRecords.length)}`],
                  tone: "success",
                },
                {
                  id: "tenant-reach",
                  help: "这些活动覆盖的租户数合计（按活动累加，非去重）。",
                  icon: "chart-bar",
                  label: "覆盖租户",
                  value: formatNumber(tenantReach),
                  tags: ["已核销租户数"],
                  tone: "success",
                },
                {
                  id: "pending-config",
                  help: "券类活动数（promotionType = coupon）。",
                  icon: "clock",
                  label: "待配置",
                  value: formatNumber(
                    records.filter(
                      (record) => record.promotionType === "coupon",
                    ).length,
                  ),
                  tags: ["优惠码"],
                  tone: "warning",
                },
              ]}
            />
            {recordsTruncated ? (
              <Banner
                tone="warning"
                title="当前优惠列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标优惠活动，请尝试缩小筛选范围（如按状态、类型等）重新查询。"
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            count={formatNumber(filteredRecords.length)}
            aria-label="营销优惠筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索优惠、套餐、负责人"
                className="grow basis-media-3xl max-w-panel-sm"
                aria-label="搜索优惠"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton
                  variant="outline"
                  icon="arrow-down"
                  onClick={handleExportAll}
                  disabled={filteredRecords.length === 0}
                >
                  导出全部
                </ActionButton>
                <ActionButton
                  variant="outline"
                  icon="plus"
                  onClick={() => {
                    setWriteError(null);
                    setCreateOpen(true);
                  }}
                >
                  新建优惠
                </ActionButton>
                <ActionButton
                  variant="outline"
                  icon="arrow-right"
                  disabled={selectedRecords.length !== 1}
                  title={
                    selectedRecords.length === 1
                      ? undefined
                      : "勾选一个批次后可发放券码"
                  }
                  onClick={() => {
                    const target = selectedRecords[0];
                    if (!target) return;
                    setWriteError(null);
                    setAssignedCodes(null);
                    setAssignTarget(target);
                  }}
                >
                  发放券码
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="优惠状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">生效中</option>
                <option value="scheduled">待开始</option>
                <option value="paused">已暂停</option>
                <option value="expired">已结束</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as TypeFilter)
                }
                aria-label="优惠类型"
              >
                <option value="all">{tShared("filters.allKinds")}</option>
                <option value="discount">套餐折扣</option>
                <option value="coupon">优惠码</option>
                <option value="campaign">活动</option>
              </NativeSelect>
            </>
          </FilterBar>
        }
        bulkBar={
          selectedRecords.length > 0 ? (
            <BulkActionBar
              count={selectedRecords.length}
              actions={[
                {
                  id: "export",
                  label: tShared("common.exportSelected"),
                  icon: "arrow-down",
                  onSelect: handleExportSelected,
                },
              ]}
              onClear={handleClearSelection}
            />
          ) : null
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="营销优惠清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            <DataTable
              columns={promotionColumns}
              rows={visibleRecords}
              rowKey={(record) => record.id}
              loading={loading}
              indexStart={(activePage - 1) * pageSize + 1}
              selectedKeys={[...selectedRecordIds]}
              onSelectionChange={(keys) => setSelectedRecordIds(new Set(keys))}
              rowActions={(record) => <PromotionActionsMenu record={record} />}
              empty={
                <EmptyState
                  title={loadError ? "优惠数据读取失败" : "没有匹配的优惠"}
                  description={
                    loadError ?? "清空筛选条件后可查看全部优惠活动。"
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
            total={filteredRecords.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={setCurrentPage}
          />
        }
      />

      {createOpen ? (
        <CreateVoucherBatchDialog
          busy={writeBusy}
          error={writeError}
          onClose={() => setCreateOpen(false)}
          onSubmit={(payload) => void handleCreateBatch(payload)}
        />
      ) : null}
      {assignTarget ? (
        <AssignVouchersDialog
          batch={assignTarget}
          busy={writeBusy}
          error={writeError}
          assignedCodes={assignedCodes}
          onClose={() => {
            setAssignTarget(null);
            setAssignedCodes(null);
          }}
          onSubmit={(payload) => void handleAssign(payload)}
        />
      ) : null}
    </>
  );
}
