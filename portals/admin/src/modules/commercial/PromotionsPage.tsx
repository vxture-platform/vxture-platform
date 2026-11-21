"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/modules/shared/table";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
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
  fetchPromotionPage,
} from "@/api/admin-bff";
import { VoucherBatchDetailDialog } from "./VoucherBatchDetailDialog";
import { useAdminSession } from "@/features/session/AdminSessionProvider";
import {
  useStepUp,
  isStepUpCancelled,
  StepUpCancelledError,
} from "@/providers/StepUpProvider";
import {
  AssignVouchersDialog,
  CreateVoucherBatchDialog,
  type CreateBatchPayload,
} from "@/modules/commercial/VoucherBatchDialogs";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
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
  if (status === "draft") return "待审核";
  if (status === "archived") return "已归档";
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
  if (status === "draft") return "warning";
  if (status === "archived") return "muted";
  if (status === "scheduled") return "warning";
  if (status === "paused") return "muted";
  return "danger";
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
  onDetail,
}: {
  onDetail: (record: PromotionOperationRecord) => void;
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
            id: "detail",
            label: "批次详情与管理",
            icon: "list",
            onSelect: () => onDetail(record),
          },
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
          icon="target"
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
        <span className="inline-flex flex-col items-center gap-2xs">
          {<Badge variant="outline">{record.scopeLabel}</Badge>}
          <span className="text-body-sm text-muted-foreground">
            {record.description}
          </span>
        </span>
      ),
    },
    {
      id: "discount",
      header: "优惠",
      align: "center",
      cell: (record) => (
        <TableTitleCell
          layout="stacked"
          title={record.discountLabel}
          description={typeLabel(record.promotionType)}
        />
      ),
    },
    {
      id: "redemption",
      header: "核销",
      align: "numeric",
      cell: (record) => (
        <span className="inline-flex flex-col items-end gap-2xs">
          {formatNumber(record.redemptionCount)}
          <span className="text-body-sm text-muted-foreground">{`${formatNumber(record.tenantCount)} 租户`}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      cell: (record) => (
        <span className="inline-flex flex-col items-center gap-2xs">
          {
            <Tag tone={statusTone(record.status)}>
              {statusLabel(record.status)}
            </Tag>
          }
          <span className="text-body-sm text-muted-foreground">
            {record.ownerName}
          </span>
        </span>
      ),
    },
    {
      id: "time",
      header: "时间",
      align: "center",
      cell: (record) => (
        <TableTitleCell
          layout="stacked"
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
  const { session } = useAdminSession();
  const canWrite =
    session.isAuthenticated &&
    session.capabilities.includes("promotion:campaign.manage");
  const [detailTarget, setDetailTarget] = useState<string | null>(null);
  const locale = useLocale();
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const [records, setRecords] = useState<PromotionOperationRecord[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    redemptions: 0,
    tenants: 0,
    coupons: 0,
  });
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
  const writeInFlight = useRef(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [assignedCodes, setAssignedCodes] = useState<string[] | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    setLoading(true);
    setSelectedRecordIds(new Set());
    fetchPromotionPage({
      page: currentPage,
      pageSize,
      status: statusFilter,
      type: typeFilter,
      q: query,
    })
      .then((items) => {
        if (active) {
          setCurrentPage((page) =>
            Math.min(page, Math.max(1, Math.ceil(items.total / pageSize))),
          );
          setRecords(items.items);
          setSummary(items.summary);
        }
      })
      .catch((error) => {
        if (active) {
          setRecords([]);
          setSummary({
            total: 0,
            active: 0,
            redemptions: 0,
            tenants: 0,
            coupons: 0,
          });
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
  }, [reloadNonce, currentPage, pageSize, statusFilter, typeFilter, query]);

  const identity = JSON.stringify([
    session.isAuthenticated,
    session.user?.id,
    [...session.capabilities].sort(),
  ]);
  const identityRef = useRef(identity);
  const mounted = useRef(true);
  identityRef.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setCreateOpen(false);
    setAssignTarget(null);
    setDetailTarget(null);
    setAssignedCodes(null);
    setWriteError(null);
  }, [identity]);

  async function handleCreateBatch(payload: CreateBatchPayload) {
    if (writeInFlight.current || !canWrite || !mounted.current) return;
    const actor = identityRef.current;
    writeInFlight.current = true;
    setWriteBusy(true);
    setWriteError(null);
    try {
      await runWithStepUp(() => {
        if (!mounted.current || actor !== identityRef.current)
          throw new StepUpCancelledError();
        return createVoucherBatch(payload);
      });
      if (!mounted.current || actor !== identityRef.current) return;
      setCreateOpen(false);
      setReloadNonce((n) => n + 1);
    } catch (error) {
      if (
        isStepUpCancelled(error) ||
        !mounted.current ||
        actor !== identityRef.current
      )
        return;
      setWriteError(
        error instanceof Error ? error.message : "批次创建失败，请稍后重试。",
      );
    } finally {
      writeInFlight.current = false;
      if (mounted.current) setWriteBusy(false);
    }
  }

  async function handleAssign(payload: {
    batchId: string;
    count: number;
    idempotencyKey: string;
    reason: string;
    targetTenantId?: string;
    targetUserId?: string;
    targetWorkspaceId?: string;
  }) {
    if (writeInFlight.current || !canWrite || !mounted.current) return;
    const actor = identityRef.current;
    writeInFlight.current = true;
    setWriteBusy(true);
    setWriteError(null);
    try {
      const result = await runWithStepUp(() => {
        if (!mounted.current || actor !== identityRef.current)
          throw new StepUpCancelledError();
        return assignVouchers(payload);
      });
      if (!mounted.current || actor !== identityRef.current) return;
      setAssignedCodes(result.codes);
      setReloadNonce((n) => n + 1);
    } catch (error) {
      if (
        isStepUpCancelled(error) ||
        !mounted.current ||
        actor !== identityRef.current
      )
        return;
      setWriteError(
        error instanceof Error ? error.message : "券码发放失败，请稍后重试。",
      );
    } finally {
      writeInFlight.current = false;
      if (mounted.current) setWriteBusy(false);
    }
  }

  const promotionColumns = usePromotionColumns();

  const filteredRecords = records;
  const pageCount = Math.max(1, Math.ceil(summary.total / pageSize));
  const activePage = currentPage;
  const visibleRecords = records;
  const activeCount = summary.active,
    redemptionCount = summary.redemptions,
    tenantReach = summary.tenants;

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
            description="管理卡券批次的草稿审核、发行预算、定向发放与审计历史。首次发行后经济配置冻结。"
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
                  value: formatNumber(summary.total),
                  tags: [`生效 ${formatNumber(activeCount)}`],
                },
                {
                  id: "redemptions",
                  help: "这些活动的核销次数合计。",
                  icon: "check",
                  label: "核销次数",
                  value: formatNumber(redemptionCount),
                  tags: [`筛选 ${formatNumber(summary.total)}`],
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
                  label: "券类活动",
                  value: formatNumber(summary.coupons),
                  tags: ["优惠码"],
                  tone: "warning",
                },
              ]}
            />
          </>
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(summary.total)}
            aria-label="营销优惠筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索优惠、套餐、负责人"
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
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
                  导出本页
                </ActionButton>
                <ActionButton
                  variant="outline"
                  icon="plus"
                  disabled={!canWrite}
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
                  disabled={
                    !canWrite ||
                    selectedRecords.length !== 1 ||
                    selectedRecords[0]?.batchStatus !== "active" ||
                    selectedRecords[0]?.status !== "active" ||
                    selectedRecords[0]?.requiresCashFunding === true
                  }
                  title={
                    selectedRecords[0]?.requiresCashFunding
                      ? "本金卡请打开批次详情，从真实销售收款生成领取凭证"
                      : selectedRecords.length === 1
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
                <option value="draft">待审核</option>
                <option value="archived">已归档</option>
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
              labels={tableLabels}
              columns={promotionColumns}
              rows={visibleRecords}
              rowKey={(record) => record.id}
              loading={loading}
              indexStart={(activePage - 1) * pageSize + 1}
              selectedKeys={[...selectedRecordIds]}
              onSelectionChange={(keys) => setSelectedRecordIds(new Set(keys))}
              rowActions={(record) => (
                <PromotionActionsMenu
                  record={record}
                  onDetail={(item) => setDetailTarget(item.id)}
                />
              )}
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
            total={summary.total}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={setCurrentPage}
          />
        }
      />

      {detailTarget ? (
        <VoucherBatchDetailDialog
          id={detailTarget}
          onClose={() => setDetailTarget(null)}
          onChanged={() => setReloadNonce((n) => n + 1)}
        />
      ) : null}
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
