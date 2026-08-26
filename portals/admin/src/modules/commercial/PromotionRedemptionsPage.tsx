"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
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
import { fetchPromotionRedemptionRecords } from "@/api/admin-bff";
import { exportRowsToCsv, type CsvColumn } from "@/lib/exportCsv";
import { isListTruncated } from "@/lib/list-truncation";
import type {
  BillingBillStatus,
  PromotionRedemptionRecord,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import {
  formatDate,
  formatNumber,
  joinClasses,
  typeLabel,
} from "@/modules/tenants/tenant-utils";
import {
  formatCurrency,
  type PageSize,
  Tag,
  type ViewMode,
} from "./CommercialUtils";

type BillStatusFilter = "all" | BillingBillStatus;

// C15: redemption status machine (applied/redeemed/reversed) removed — no status
// column on voucher_redemptions (a redemption row IS a completed redemption; the
// applied/reversed states never existed in schema). Every row is 已核销.

function billStatusLabel(status: BillingBillStatus) {
  if (status === "paying") return "支付中";
  if (status === "paid") return "已结清";
  if (status === "partial") return "部分收款";
  if (status === "cancelled") return "已作废";
  if (status === "overdue") return "逾期";
  return "待收款";
}

function billStatusTone(status: BillingBillStatus) {
  if (status === "paid") return "normal";
  if (status === "cancelled") return "muted";
  if (status === "overdue") return "danger";
  return "warning";
}

function redemptionSearchText(record: PromotionRedemptionRecord) {
  return [
    record.redemptionNo,
    record.promotionCode,
    record.promotionName,
    record.tenantCode,
    record.tenantName,
    record.orderNo,
    record.billNo,
    record.servicePlanName,
    record.operatorName,
    record.remark,
    billStatusLabel(record.billStatus),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

const REDEMPTION_CSV_COLUMNS: CsvColumn<PromotionRedemptionRecord>[] = [
  { label: "核销编号", value: (record) => record.redemptionNo },
  { label: "券码", value: (record) => record.promotionCode },
  { label: "优惠编号", value: (record) => record.promotionCode },
  { label: "优惠名称", value: (record) => record.promotionName },
  { label: "租户编号", value: (record) => record.tenantCode },
  { label: "租户名称", value: (record) => record.tenantName },
  { label: "租户类型", value: (record) => typeLabel(record.tenantType) },
  { label: "订单号", value: (record) => record.orderNo ?? "" },
  { label: "账单号", value: (record) => record.billNo },
  { label: "账单状态", value: (record) => billStatusLabel(record.billStatus) },
  { label: "套餐", value: (record) => record.servicePlanName ?? "" },
  { label: "货币", value: (record) => record.currency },
  { label: "订单金额", value: (record) => record.orderAmount },
  { label: "优惠金额", value: (record) => record.discountAmount },
  { label: "应付金额", value: (record) => record.payableAmount },
  { label: "操作人", value: (record) => record.operatorName },
  { label: "核销时间", value: (record) => formatDate(record.redeemedAt) },
  { label: "备注", value: (record) => record.remark ?? "" },
];

function RedemptionActionsMenu({
  record,
}: {
  record: PromotionRedemptionRecord;
}) {
  const tShared = useTranslations();
  const router = useRouter();

  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${record.redemptionNo} 核销操作`}
        items={[
          {
            id: "bill",
            label: "账单详情",
            icon: "arrow-right",
            onSelect: () =>
              router.push(`/billing/${encodeURIComponent(record.billId)}`),
          },
          {
            id: "tenant",
            label: tShared("actions.viewTenant"),
            icon: "buildings",
            onSelect: () =>
              router.push(`/tenants/${encodeURIComponent(record.tenantId)}`),
          },
          {
            id: "orders",
            label: "订单列表",
            icon: "table",
            onSelect: () => router.push("/orders"),
          },
          {
            id: "promotions",
            label: "优惠活动",
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
  const router = useRouter();

  return [
    {
      id: "redemption",
      header: "核销记录",
      cell: (record) => (
        <TableTitleCell
          title={record.redemptionNo}
          description={`${record.promotionCode} · ${record.promotionName}`}
          onTitleClick={() =>
            router.push(`/billing/${encodeURIComponent(record.billId)}`)
          }
        />
      ),
    },
    {
      id: "tenant",
      header: "租户",
      cell: (record) => (
        <TableTitleCell
          icon={record.tenantType === "company" ? "buildings" : "user"}
          title={record.tenantName}
          description={`${record.tenantCode} · ${typeLabel(record.tenantType)}`}
        />
      ),
    },
    {
      id: "bill",
      header: "账单",
      cell: (record) => (
        <TableTitleCell
          title={
            <Tag tone={billStatusTone(record.billStatus)}>
              {billStatusLabel(record.billStatus)}
            </Tag>
          }
          description={`${record.billNo} · ${record.orderNo ?? "未关联订单"}`}
        />
      ),
    },
    {
      id: "discount",
      header: "优惠金额",
      align: "right",
      cell: (record) => (
        <TableTitleCell
          title={formatCurrency(record.discountAmount, record.currency)}
          description={`应付 ${formatCurrency(record.payableAmount, record.currency)} / 原价 ${formatCurrency(record.orderAmount, record.currency)}`}
        />
      ),
    },
    {
      id: "operator",
      header: "核销方",
      align: "center",
      cell: (record) => (
        <TableTitleCell title={record.operatorName} description="已核销" />
      ),
    },
    {
      id: "time",
      header: "时间",
      align: "center",
      cell: (record) => (
        <TableTitleCell
          title={formatDate(record.redeemedAt)}
          description={record.remark ?? "系统记录"}
        />
      ),
    },
  ];
}

function RedemptionCards({
  records,
}: {
  records: PromotionRedemptionRecord[];
}) {
  const router = useRouter();

  return (
    <div
      className="vx-tenant-directory-cards vx-commercial-cards"
      aria-label="优惠核销卡片"
    >
      {records.map((record) => (
        <article
          key={record.id}
          className={joinClasses(
            "vx-tenant-directory-card",
            "vx-commercial-card--normal",
          )}
          role="button"
          tabIndex={0}
          onClick={() =>
            router.push(`/billing/${encodeURIComponent(record.billId)}`)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter")
              router.push(`/billing/${encodeURIComponent(record.billId)}`);
          }}
        >
          <header>
            <Icon name="sparkles" size="lg" fallback="placeholder" />
            <div>
              <strong>{record.redemptionNo}</strong>
              <span>
                {record.tenantName} · {record.promotionName}
              </span>
            </div>
            <RedemptionActionsMenu record={record} />
          </header>
          <div className="vx-tenant-directory-card__badges">
            <Tag tone="normal">已核销</Tag>
            <Tag tone={billStatusTone(record.billStatus)}>
              {billStatusLabel(record.billStatus)}
            </Tag>
          </div>
          <p className="vx-commercial-card__description">
            {record.billNo} ·{" "}
            {record.servicePlanName ?? record.orderNo ?? "未关联套餐"}
          </p>
          <div className="vx-tenant-directory-card__metrics">
            <span>
              <b>{formatCurrency(record.discountAmount, record.currency)}</b>
              <small>优惠金额</small>
            </span>
            <span>
              <b>{formatCurrency(record.payableAmount, record.currency)}</b>
              <small>账单应付</small>
            </span>
            <span>
              <b>{formatDate(record.redeemedAt)}</b>
              <small>{record.operatorName}</small>
            </span>
          </div>
          <footer>
            <span>{record.promotionCode}</span>
            <strong>{record.orderNo ?? "未关联订单"}</strong>
          </footer>
        </article>
      ))}
    </div>
  );
}

export function PromotionRedemptionsPage() {
  const tShared = useTranslations();
  const [records, setRecords] = useState<PromotionRedemptionRecord[]>([]);
  const [recordsTruncated, setRecordsTruncated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
            error instanceof Error ? error.message : "核销数据读取失败",
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

  const redemptionColumns = useRedemptionColumns();

  const filteredRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return records.filter((record) => {
      if (billStatusFilter !== "all" && record.billStatus !== billStatusFilter)
        return false;
      if (
        normalizedQuery &&
        !redemptionSearchText(record).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [billStatusFilter, query, records]);

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
  }, [billStatusFilter, pageSize, query, viewMode]);

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
      REDEMPTION_CSV_COLUMNS,
      selectedRecords,
    );
  }

  function handleExportAll() {
    exportRowsToCsv(
      "promotion-redemptions-export",
      REDEMPTION_CSV_COLUMNS,
      filteredRecords,
    );
  }

  function handleClearSelection() {
    setSelectedRecordIds(new Set());
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-redemptions-page"
        header={
          <PageHeader
            icon="check"
            eyebrow="订阅交易"
            title="优惠核销"
            description="运营侧查看券核销台账（核销均为客户自助）。减免金额来自账单 discount_amount。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="优惠核销统计"
              items={[
                {
                  id: "records",
                  help: "当前筛选条件下的优惠核销记录条数。",
                  icon: "check",
                  label: "核销记录",
                  value: formatNumber(records.length),
                  tags: [`筛选 ${formatNumber(filteredRecords.length)}`],
                },
                {
                  id: "discount",
                  help: "这些核销记录带来的减免金额合计。",
                  icon: "chart-bar",
                  label: "减免金额",
                  value: formatCurrency(discountAmount, "CNY"),
                  tags: ["账单减免"],
                  tone: "success",
                },
                {
                  id: "tenant-reach",
                  help: "核销记录去重后涉及的租户数。",
                  icon: "buildings",
                  label: "覆盖租户",
                  value: formatNumber(tenantReach),
                  tags: ["去重"],
                  tone: "success",
                },
                {
                  id: "paid-bills",
                  help: "关联账单已结清的核销记录数。",
                  icon: "sparkles",
                  label: "账单已结清",
                  value: formatNumber(paidBillCount),
                  tags: ["billStatus=paid"],
                  tone: "success",
                },
              ]}
            />
            {recordsTruncated ? (
              <Banner
                tone="warning"
                title="当前核销列表可能未展示全部数据"
                description="本次加载已达到单次读取上限（500 条），如未看到目标记录，请尝试缩小筛选范围（如按账单状态等）重新查询。"
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
            aria-label="优惠核销筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索核销、租户、账单、套餐"
                className="vx-tenant-search vx-commercial-search"
                aria-label="搜索核销"
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
              </>
            }
          >
            <div className="vx-tenant-filters">
              <NativeSelect
                className="vx-input vx-tenant-select"
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
                <option value="cancelled">
                  {tShared("status.generic.voided")}
                </option>
              </NativeSelect>
            </div>
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
          <section className="vx-tenant-directory" aria-label="优惠核销清单">
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="vx-tenant-directory__header">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}
            {viewMode === "list" ? (
              <DataTable
                columns={redemptionColumns}
                rows={visibleRecords}
                rowKey={(record) => record.id}
                loading={loading}
                indexStart={(activePage - 1) * pageSize + 1}
                selectedKeys={[...selectedRecordIds]}
                onSelectionChange={(keys) =>
                  setSelectedRecordIds(new Set(keys))
                }
                rowActions={(record) => (
                  <RedemptionActionsMenu record={record} />
                )}
                empty={
                  <EmptyState
                    title={
                      loadError ? "核销数据读取失败" : "没有匹配的核销记录"
                    }
                    description={
                      loadError ?? "清空筛选条件后可查看全部核销记录。"
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
              <RedemptionCards records={visibleRecords} />
            ) : (
              <EmptyState
                title={
                  loading
                    ? "正在加载核销记录"
                    : loadError
                      ? "核销数据读取失败"
                      : "没有匹配的核销记录"
                }
                description={
                  loading
                    ? "正在读取优惠核销台账。"
                    : (loadError ?? "清空筛选条件后可查看全部核销记录。")
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
