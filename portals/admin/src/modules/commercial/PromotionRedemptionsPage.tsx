"use client";

/**
 * PromotionRedemptionsPage.tsx - Cash and subscription benefit redemption evidence.
 * @package @vxture/admin
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-19
 */
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { visibleIdOr } from "@/lib/visible-id";
import { useTableLabels } from "@/modules/shared/table";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
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
import { fetchPromotionRedemptionRecords } from "@/api/admin-bff";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { isListTruncated } from "@/lib/list-truncation";
import type {
  BillingBillStatus,
  PromotionRedemptionRecord,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { useBillStatusLabels } from "@/modules/shared/enum-labels";
import type { BillStatus } from "@vxture-platform/shared";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";
import { Tag, type PageSize, formatCurrency } from "./CommercialUtils";
import { formatPrincipalNoOr } from "@vxture-platform/shared";

// ===========================================================================
// Read models keep absent bills distinct from paid bills and cash discounts.
// ===========================================================================
type BillStatusFilter = "all" | "none" | BillingBillStatus;

// C15: redemption status machine (applied/redeemed/reversed) removed — no status
// column on voucher_redemptions (a redemption row IS a completed redemption; the
// applied/reversed states never existed in schema). Every row is 已核销.

function billStatusTone(status: BillingBillStatus) {
  if (status === "paid") return "normal";
  if (status === "cancelled") return "muted";
  if (status === "overdue") return "danger";
  return "warning";
}

function redemptionSearchText(
  record: PromotionRedemptionRecord,
  billStatusLabels: Record<BillStatus, string>,
  tShared: ReturnType<typeof useTranslations>,
) {
  return [
    record.redemptionNo,
    record.promotionCode,
    record.promotionName,
    formatPrincipalNoOr(record.tenantCode, "tenant", "—"),
    record.tenantName,
    record.orderNo,
    record.billNo,
    record.servicePlanName,
    record.operatorName,
    record.remark,
    record.benefitLabel,
    record.billStatus
      ? billStatusLabels[record.billStatus]
      : tShared("voucherManagement.redemptions.noBill"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function redemptionCsvColumns(
  locale: string,
  billStatusLabels: Record<BillStatus, string>,
  tShared: ReturnType<typeof useTranslations>,
): CsvColumn<PromotionRedemptionRecord>[] {
  return [
    {
      label: tShared("voucherManagement.redemptions.redemptionNo"),
      value: (record) => record.redemptionNo,
    },
    {
      label: tShared("voucherManagement.redemptions.voucherCode"),
      value: (record) => record.promotionCode,
    },
    {
      label: tShared("voucherManagement.redemptions.promotionCode"),
      value: (record) => record.promotionCode,
    },
    {
      label: tShared("voucherManagement.redemptions.promotionName"),
      value: (record) => record.promotionName,
    },
    {
      label: tShared("voucherManagement.redemptions.benefit"),
      value: (record) => record.benefitLabel,
    },
    {
      label: tShared("voucherManagement.redemptions.subscription"),
      value: (record) =>
        visibleIdOr(
          record.subscriptionId,
          tShared("voucherManagement.common.unavailable"),
        ),
    },
    {
      label: tShared("voucherManagement.redemptions.tenantCode"),
      value: (record) => formatPrincipalNoOr(record.tenantCode, "tenant", "—"),
    },
    {
      label: tShared("voucherManagement.redemptions.tenantName"),
      value: (record) => record.tenantName,
    },
    {
      label: tShared("voucherManagement.redemptions.tenantType"),
      value: (record) =>
        record.tenantType === "company"
          ? tShared("voucherManagement.redemptions.company")
          : tShared("voucherManagement.redemptions.individual"),
    },
    {
      label: tShared("voucherManagement.redemptions.orderNo"),
      value: (record) => record.orderNo ?? "",
    },
    {
      label: tShared("voucherManagement.redemptions.billNo"),
      value: (record) => record.billNo,
    },
    {
      label: tShared("voucherManagement.redemptions.billStatus"),
      value: (record) =>
        record.billStatus
          ? billStatusLabels[record.billStatus]
          : tShared("voucherManagement.redemptions.noBill"),
    },
    {
      label: tShared("voucherManagement.redemptions.plan"),
      value: (record) => record.servicePlanName ?? "",
    },
    {
      label: tShared("voucherManagement.redemptions.currency"),
      value: (record) => (record.billId ? record.currency : ""),
    },
    {
      label: tShared("voucherManagement.redemptions.orderAmount"),
      value: (record) => (record.billId ? record.orderAmount : ""),
    },
    {
      label: tShared("voucherManagement.redemptions.discountAmount"),
      value: (record) => (record.billId ? record.discountAmount : ""),
    },
    {
      label: tShared("voucherManagement.redemptions.payableAmount"),
      value: (record) => (record.billId ? record.payableAmount : ""),
    },
    {
      label: tShared("voucherManagement.redemptions.operator"),
      value: (record) => record.operatorName,
    },
    {
      label: tShared("voucherManagement.redemptions.redeemedAt"),
      value: (record) => formatDate(record.redeemedAt, locale),
    },
    {
      label: tShared("voucherManagement.redemptions.remark"),
      value: (record) => record.remark ?? "",
    },
  ];
}

function RedemptionActionsMenu({
  record,
}: {
  record: PromotionRedemptionRecord;
}) {
  const tShared = useTranslations();
  const router = useRouter();

  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={tShared("voucherManagement.redemptions.actions", {
          number: record.redemptionNo,
        })}
        items={[
          {
            id: "bill",
            label: tShared("voucherManagement.redemptions.billDetail"),
            icon: "arrow-right",
            disabled: !record.billNo,
            onSelect: () =>
              router.push(`/billing/${encodeURIComponent(record.billNo)}`),
          },
          ...(record.subscriptionId
            ? [
                {
                  id: "subscription",
                  label: tShared(
                    "voucherManagement.redemptions.subscriptionDetail",
                  ),
                  icon: "arrow-right" as const,
                  onSelect: () =>
                    router.push(
                      `/subscriptions/${encodeURIComponent(record.subscriptionId!)}`,
                    ),
                },
              ]
            : []),
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(record.tenantCode)}`),
          },
          {
            id: "orders",
            label: tShared("voucherManagement.redemptions.orders"),
            icon: "table",
            onSelect: () => router.push("/orders"),
          },
          {
            id: "promotions",
            label: tShared("voucherManagement.redemptions.promotions"),
            icon: "sparkles",
            onSelect: () => router.push("/promotions"),
          },
        ]}
      />
    </div>
  );
}

/** 这一页的标已经是 DS `Tag`，不带业务色类，与批 4 无关。 */
function useRedemptionColumns(): DataTableColumn<PromotionRedemptionRecord>[] {
  const tShared = useTranslations();
  const billStatusLabels = useBillStatusLabels();
  const locale = useLocale();
  const router = useRouter();

  return [
    {
      id: "redemption",
      header: tShared("voucherManagement.redemptions.records"),
      cell: (record) => (
        <TableTitleCell
          icon="check"
          title={record.redemptionNo}
          description={`${record.promotionCode} · ${record.promotionName}`}
          onTitleClick={() =>
            record.subscriptionId
              ? router.push(
                  `/subscriptions/${encodeURIComponent(record.subscriptionId)}`,
                )
              : record.billNo
                ? router.push(`/billing/${encodeURIComponent(record.billNo)}`)
                : undefined
          }
        />
      ),
    },
    {
      id: "tenant",
      header: tShared("voucherManagement.redemptions.tenant"),
      cell: (record) => (
        <TableTitleCell
          icon={
            record.tenantType === "company" ? "buildings" : "building-office"
          }
          title={record.tenantName}
          description={`${formatPrincipalNoOr(record.tenantCode, "tenant", "—")} · ${record.tenantType === "company" ? tShared("voucherManagement.redemptions.company") : tShared("voucherManagement.redemptions.individual")}`}
        />
      ),
    },
    {
      id: "bill",
      header: tShared("voucherManagement.redemptions.bill"),
      cell: (record) => (
        <span className="inline-flex flex-col items-center gap-2xs">
          {record.billStatus ? (
            <Tag tone={billStatusTone(record.billStatus)}>
              {billStatusLabels[record.billStatus]}
            </Tag>
          ) : (
            <Tag tone="muted">
              {tShared("voucherManagement.redemptions.noBill")}
            </Tag>
          )}
          <span className="text-body-sm text-muted-foreground">
            {[record.billNo, record.orderNo].filter(Boolean).join(" · ") ||
              (record.kind === "recharge_card"
                ? tShared("voucherManagement.redemptions.recharge")
                : tShared("voucherManagement.redemptions.subscriptionBenefit"))}
          </span>
        </span>
      ),
    },
    {
      id: "discount",
      header: tShared("voucherManagement.redemptions.benefitAmount"),
      align: "numeric",
      cell: (record) => (
        <span className="inline-flex flex-col items-end gap-2xs">
          {record.billId
            ? formatCurrency(record.discountAmount, record.currency)
            : record.benefitLabel}
          <span className="text-body-sm text-muted-foreground">
            {record.billId
              ? tShared("voucherManagement.redemptions.amounts", {
                  payable: formatCurrency(
                    record.payableAmount,
                    record.currency,
                  ),
                  original: formatCurrency(record.orderAmount, record.currency),
                })
              : tShared("voucherManagement.redemptions.noAmount")}
          </span>
        </span>
      ),
    },
    {
      id: "operator",
      header: tShared("voucherManagement.redemptions.redeemer"),
      align: "center",
      cell: (record) => (
        <TableTitleCell
          layout="stacked"
          title={record.operatorName}
          description={tShared("voucherManagement.redemptions.redeemed")}
        />
      ),
    },
    {
      id: "time",
      header: tShared("voucherManagement.redemptions.time"),
      align: "center",
      cell: (record) => (
        <TableTitleCell
          layout="stacked"
          title={formatDate(record.redeemedAt, locale)}
          description={
            record.remark ?? tShared("voucherManagement.redemptions.system")
          }
        />
      ),
    },
  ];
}

export function PromotionRedemptionsPage() {
  const locale = useLocale();
  const billStatusLabels = useBillStatusLabels();
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const [records, setRecords] = useState<PromotionRedemptionRecord[]>([]);
  const [recordsTruncated, setRecordsTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [billStatusFilter, setBillStatusFilter] =
    useState<BillStatusFilter>("all");
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
    fetchPromotionRedemptionRecords()
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
            error instanceof Error
              ? error.message
              : tShared("voucherManagement.redemptions.loadFailed"),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tShared]);

  const redemptionColumns = useRedemptionColumns();

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (
        billStatusFilter === "none"
          ? Boolean(record.billId)
          : billStatusFilter !== "all" && record.billStatus !== billStatusFilter
      )
        return false;
      if (
        normalizedQuery &&
        !redemptionSearchText(record, billStatusLabels, tShared).includes(
          normalizedQuery,
        )
      )
        return false;
      return true;
    });
  }, [billStatusFilter, query, records, billStatusLabels, tShared]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleRecords = filteredRecords.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const discountAmount = records.reduce(
    (sum, record) => sum + record.discountAmount,
    0,
  );
  const tenantReach = new Set(records.map((record) => record.tenantId)).size;
  const paidBillCount = records.filter(
    (record) => record.billStatus === "paid",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [billStatusFilter, pageSize, query]);

  function handleReset() {
    setQuery("");
    setBillStatusFilter("all");
  }

  const selectedRecords = records.filter((record) =>
    selectedRecordIds.has(record.id),
  );

  function handleExportSelected() {
    exportRowsToCsv(
      "promotion-redemptions-export",
      redemptionCsvColumns(locale, billStatusLabels, tShared),
      selectedRecords,
    );
  }

  function handleExportAll() {
    exportRowsToCsv(
      "promotion-redemptions-export",
      redemptionCsvColumns(locale, billStatusLabels, tShared),
      filteredRecords,
    );
  }

  function handleClearSelection() {
    setSelectedRecordIds(new Set());
  }

  return (
    <>
      <ListPageTemplate
        className="w-full vx-redemptions-page"
        header={
          <PageHeader
            icon="check"
            eyebrow={tShared("voucherManagement.redemptions.eyebrow")}
            title={tShared("voucherManagement.redemptions.title")}
            description={tShared("voucherManagement.redemptions.description")}
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label={tShared("voucherManagement.redemptions.statistics")}
              items={[
                {
                  id: "records",
                  help: tShared("voucherManagement.redemptions.recordsHelp"),
                  icon: "check",
                  label: tShared("voucherManagement.redemptions.records"),
                  value: formatNumber(records.length),
                  tags: [
                    tShared("voucherManagement.redemptions.filtered", {
                      count: formatNumber(filteredRecords.length),
                    }),
                  ],
                },
                {
                  id: "discount",
                  help: tShared("voucherManagement.redemptions.discountHelp"),
                  icon: "chart-bar",
                  label: tShared("voucherManagement.redemptions.discount"),
                  value: formatCurrency(discountAmount, "CNY"),
                  tags: [tShared("voucherManagement.redemptions.billDiscount")],
                  tone: "success",
                },
                {
                  id: "tenant-reach",
                  help: tShared("voucherManagement.redemptions.tenantsHelp"),
                  icon: "buildings",
                  label: tShared("voucherManagement.redemptions.tenants"),
                  value: formatNumber(tenantReach),
                  tags: [tShared("voucherManagement.redemptions.distinct")],
                  tone: "success",
                },
                {
                  id: "paid-bills",
                  help: tShared("voucherManagement.redemptions.paidHelp"),
                  icon: "sparkles",
                  label: tShared("voucherManagement.redemptions.settled"),
                  value: formatNumber(paidBillCount),
                  tags: [tShared("voucherManagement.redemptions.settledTag")],
                  tone: "success",
                },
              ]}
            />
            {recordsTruncated ? (
              <Banner
                tone="warning"
                title={tShared("voucherManagement.redemptions.truncated")}
                description={tShared(
                  "voucherManagement.redemptions.truncatedHint",
                )}
              />
            ) : null}
          </>
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredRecords.length)}
            aria-label={tShared("voucherManagement.redemptions.filters")}
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tShared(
                  "voucherManagement.redemptions.searchPlaceholder",
                )}
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label={tShared("voucherManagement.redemptions.search")}
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
                  {tShared("voucherManagement.redemptions.exportAll")}
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
                aria-label={tShared("voucherManagement.redemptions.billStatus")}
              >
                <option value="all">
                  {tShared("voucherManagement.redemptions.allBills")}
                </option>
                <option value="none">
                  {tShared("voucherManagement.redemptions.noBill")}
                </option>
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
                <option value="cancelled">
                  {tShared("status.generic.voided")}
                </option>
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
            aria-label={tShared("voucherManagement.redemptions.list")}
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            <DataTable
              labels={tableLabels}
              columns={redemptionColumns}
              rows={visibleRecords}
              rowKey={(record) => record.id}
              loading={loading}
              indexStart={(activePage - 1) * pageSize + 1}
              selectedKeys={[...selectedRecordIds]}
              onSelectionChange={(keys) => setSelectedRecordIds(new Set(keys))}
              rowActions={(record) => <RedemptionActionsMenu record={record} />}
              empty={
                <EmptyState
                  title={
                    loadError
                      ? tShared("voucherManagement.redemptions.loadFailed")
                      : tShared("voucherManagement.redemptions.empty")
                  }
                  description={
                    loadError ??
                    tShared("voucherManagement.redemptions.emptyHint")
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
    </>
  );
}
