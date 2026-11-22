"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  usePromotionStatusLabels,
  usePromotionTypeLabels,
} from "@/modules/shared/enum-labels";
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
import { useVoucherDisplay } from "./voucher-display";
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
  tShared: ReturnType<typeof useTranslations>,
  statusLabels: Record<PromotionOperationStatus, string>,
  typeLabels: Record<PromotionOperationType, string>,
  display: ReturnType<typeof useVoucherDisplay>,
): CsvColumn<PromotionOperationRecord>[] {
  return [
    {
      label: tShared("voucherManagement.promotions.promotionCode"),
      value: display.prefix,
    },
    {
      label: tShared("voucherManagement.promotions.promotionName"),
      value: (record) => record.promotionName,
    },
    {
      label: tShared("voucherManagement.promotions.type"),
      value: (record) => typeLabels[record.promotionType],
    },
    {
      label: tShared("voucherManagement.promotions.status"),
      value: (record) => statusLabels[record.status],
    },
    {
      label: tShared("voucherManagement.promotions.scope"),
      value: display.scope,
    },
    {
      label: tShared("voucherManagement.promotions.benefit"),
      value: display.benefit,
    },
    {
      label: tShared("voucherManagement.promotions.redemptions"),
      value: (record) => record.redemptionCount,
    },
    {
      label: tShared("voucherManagement.promotions.tenants"),
      value: (record) => record.tenantCount,
    },
    {
      label: tShared("voucherManagement.promotions.owner"),
      value: (record) => record.ownerName,
    },
    {
      label: tShared("voucherManagement.promotions.startsAt"),
      value: (record) => formatDate(record.startsAt, locale),
    },
    {
      label: tShared("voucherManagement.promotions.endsAt"),
      value: (record) =>
        record.endsAt
          ? formatDate(record.endsAt, locale)
          : tShared("voucherManagement.promotions.ongoing"),
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
  const tShared = useTranslations();

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={tShared("voucherManagement.promotions.actions", {
          name: record.promotionName,
        })}
        items={[
          {
            id: "detail",
            label: tShared("voucherManagement.promotions.manage"),
            icon: "list",
            onSelect: () => onDetail(record),
          },
          {
            id: "redemptions",
            label: tShared("voucherManagement.promotions.viewRedemptions"),
            icon: "check",
            onSelect: () => router.push("/promotion-redemptions"),
          },
          {
            id: "service-plans",
            label: tShared("voucherManagement.promotions.servicePlans"),
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
  const display = useVoucherDisplay();
  const statusLabels = usePromotionStatusLabels();
  const typeLabels = usePromotionTypeLabels();
  const locale = useLocale();
  const tShared = useTranslations();
  const router = useRouter();

  return [
    {
      id: "promotion",
      header: tShared("voucherManagement.promotions.promotion"),
      cell: (record) => (
        <TableTitleCell
          icon="target"
          title={record.promotionName}
          description={`${tShared("voucherManagement.promotions.prefixValue", { prefix: display.prefix(record) })} · ${typeLabels[record.promotionType]}`}
          onTitleClick={() => router.push("/promotion-redemptions")}
        />
      ),
    },
    {
      id: "scope",
      header: tShared("voucherManagement.promotions.scope"),
      cell: (record) => (
        <span className="inline-flex flex-col items-center gap-2xs">
          {<Badge variant="outline">{display.scope(record)}</Badge>}
          <span className="text-body-sm text-muted-foreground">
            {display.description(record)}
          </span>
        </span>
      ),
    },
    {
      id: "discount",
      header: tShared("voucherManagement.promotions.benefit"),
      align: "center",
      cell: (record) => (
        <TableTitleCell
          layout="stacked"
          title={display.benefit(record)}
          description={typeLabels[record.promotionType]}
        />
      ),
    },
    {
      id: "redemption",
      header: tShared("voucherManagement.promotions.redemption"),
      align: "numeric",
      cell: (record) => (
        <span className="inline-flex flex-col items-end gap-2xs">
          {formatNumber(record.redemptionCount)}
          <span className="text-body-sm text-muted-foreground">
            {tShared("voucherManagement.promotions.tenantCount", {
              count: formatNumber(record.tenantCount),
            })}
          </span>
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
              {statusLabels[record.status]}
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
      header: tShared("voucherManagement.promotions.time"),
      align: "center",
      cell: (record) => (
        <TableTitleCell
          layout="stacked"
          title={formatDate(record.startsAt, locale)}
          description={
            record.endsAt
              ? formatDate(record.endsAt, locale)
              : tShared("voucherManagement.promotions.ongoing")
          }
        />
      ),
    },
  ];
}

export function PromotionsPage() {
  const display = useVoucherDisplay();
  const statusLabels = usePromotionStatusLabels();
  const typeLabels = usePromotionTypeLabels();
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
            error instanceof Error
              ? error.message
              : tShared("voucherManagement.promotions.loadFailed"),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    reloadNonce,
    currentPage,
    pageSize,
    statusFilter,
    typeFilter,
    query,
    tShared,
  ]);

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
        error instanceof Error
          ? error.message
          : tShared("voucherManagement.promotions.createFailed"),
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
        error instanceof Error
          ? error.message
          : tShared("voucherManagement.promotions.assignFailed"),
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
      promotionCsvColumns(locale, tShared, statusLabels, typeLabels, display),
      selectedRecords,
    );
  }

  function handleExportAll() {
    exportRowsToCsv(
      "promotions-export",
      promotionCsvColumns(locale, tShared, statusLabels, typeLabels, display),
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
            eyebrow={tShared("voucherManagement.promotions.eyebrow")}
            title={tShared("voucherManagement.promotions.title")}
            description={tShared("voucherManagement.promotions.description")}
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label={tShared("voucherManagement.promotions.statistics")}
              items={[
                {
                  id: "promotions",
                  help: tShared("voucherManagement.promotions.promotionHelp"),
                  icon: "sparkles",
                  label: tShared("voucherManagement.promotions.promotion"),
                  value: formatNumber(summary.total),
                  tags: [
                    tShared("voucherManagement.promotions.activeCount", {
                      count: formatNumber(activeCount),
                    }),
                  ],
                },
                {
                  id: "redemptions",
                  help: tShared("voucherManagement.promotions.redemptionHelp"),
                  icon: "check",
                  label: tShared("voucherManagement.promotions.redemptions"),
                  value: formatNumber(redemptionCount),
                  tags: [
                    tShared("voucherManagement.promotions.filteredCount", {
                      count: formatNumber(summary.total),
                    }),
                  ],
                  tone: "success",
                },
                {
                  id: "tenant-reach",
                  help: tShared("voucherManagement.promotions.tenantHelp"),
                  icon: "chart-bar",
                  label: tShared("voucherManagement.promotions.tenantReach"),
                  value: formatNumber(tenantReach),
                  tags: [
                    tShared("voucherManagement.promotions.redeemingTenants"),
                  ],
                  tone: "success",
                },
                {
                  id: "pending-config",
                  help: tShared("voucherManagement.promotions.couponHelp"),
                  icon: "clock",
                  label: tShared("voucherManagement.promotions.coupons"),
                  value: formatNumber(summary.coupons),
                  tags: [tShared("voucherManagement.promotions.couponCode")],
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
            aria-label={tShared("voucherManagement.promotions.filters")}
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tShared(
                  "voucherManagement.promotions.searchPlaceholder",
                )}
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label={tShared("voucherManagement.promotions.search")}
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
                  {tShared("voucherManagement.promotions.exportPage")}
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
                  {tShared("voucherManagement.promotions.create")}
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
                      ? tShared("voucherManagement.promotions.fundedCardHint")
                      : selectedRecords.length === 1
                        ? undefined
                        : tShared(
                            "voucherManagement.promotions.selectBatchHint",
                          )
                  }
                  onClick={() => {
                    const target = selectedRecords[0];
                    if (!target) return;
                    setWriteError(null);
                    setAssignedCodes(null);
                    setAssignTarget(target);
                  }}
                >
                  {tShared("voucherManagement.promotions.assign")}
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
                aria-label={tShared(
                  "voucherManagement.promotions.statusFilter",
                )}
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="draft">{statusLabels.draft}</option>
                <option value="archived">{statusLabels.archived}</option>
                <option value="active">{statusLabels.active}</option>
                <option value="scheduled">{statusLabels.scheduled}</option>
                <option value="paused">{statusLabels.paused}</option>
                <option value="expired">{statusLabels.expired}</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as TypeFilter)
                }
                aria-label={tShared("voucherManagement.promotions.typeFilter")}
              >
                <option value="all">{tShared("filters.allKinds")}</option>
                <option value="discount">{typeLabels.discount}</option>
                <option value="coupon">{typeLabels.coupon}</option>
                <option value="campaign">{typeLabels.campaign}</option>
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
            aria-label={tShared("voucherManagement.promotions.list")}
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
                  title={
                    loadError
                      ? tShared("voucherManagement.promotions.loadFailed")
                      : tShared("voucherManagement.promotions.empty")
                  }
                  description={
                    loadError ??
                    tShared("voucherManagement.promotions.emptyHint")
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
