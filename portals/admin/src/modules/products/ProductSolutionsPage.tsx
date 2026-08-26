"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn } from "@vxture/design-system";
import { tierBadgeClass } from "@/modules/shared/tier-level";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { IconName } from "@vxture/design-system";
import { fetchProductSolutions } from "@/api/admin-bff";
import type {
  ProductSolutionCapability,
  ProductSolutionCapabilitySource,
  ProductSolutionCapabilityType,
  ProductSolutionRecord,
  ProductSolutionStatus,
  ProductSolutionVisibility,
} from "@/entities/console";
import {
  PUBLISH_STATUS_TONE,
  VISIBILITY_TONE,
} from "@/modules/shared/publish-tone";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  formatDate,
  formatMoney,
  formatNumber,
  joinClasses,
} from "@/modules/tenants/tenant-utils";

type ViewMode = "list" | "cards";
type StatusFilter = "all" | ProductSolutionStatus;
type VisibilityFilter = "all" | ProductSolutionVisibility;
type IndustryFilter = "all" | string;
type SourceFilter = "all" | ProductSolutionCapabilitySource;

function solutionStatusLabel(status: ProductSolutionStatus) {
  if (status === "active") return "启用";
  if (status === "draft") return "草稿";
  return "归档";
}

function solutionVisibilityLabel(visibility: ProductSolutionVisibility) {
  return visibility === "public" ? "公开" : "内部";
}

function capabilityTypeLabel(type: ProductSolutionCapabilityType) {
  if (type === "platform") return "平台";
  if (type === "agent") return "智能体";
  if (type === "model") return "模型";
  if (type === "data") return "数据";
  return "服务";
}

function capabilityTypeIcon(type: ProductSolutionCapabilityType): IconName {
  if (type === "platform") return "database";
  if (type === "agent") return "agent";
  if (type === "model") return "cloud";
  if (type === "data") return "table";
  return "server";
}

function capabilitySourceLabel(source: ProductSolutionCapabilitySource) {
  return source === "self" ? "自建" : "三方";
}

function solutionSearchText(solution: ProductSolutionRecord) {
  return [
    solution.solutionCode,
    solution.solutionName,
    solution.description,
    solution.industry,
    solution.scenario,
    solution.customerSegment,
    solution.ownerTeam,
    solution.status,
    solution.visibility,
    ...solution.tags,
    ...solution.products.map(
      (product) =>
        `${product.productCode} ${product.productName} ${product.role} ${product.productType} ${product.source}`,
    ),
    ...solution.tiers.map(
      (tier) => `${tier.tierCode} ${tier.tierName} ${tier.summary}`,
    ),
  ]
    .join(" ")
    .toLowerCase();
}

function ProductSolutionActionsMenu({
  solution,
  onViewDetails,
}: {
  solution: ProductSolutionRecord;
  onViewDetails: () => void;
}) {
  const tShared = useTranslations();
  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${solution.solutionName} 操作`}
        items={[
          {
            id: "details",
            label: tShared("actions.viewDetail"),
            icon: "arrow-right",
            onSelect: onViewDetails,
          },
          {
            id: "edit",
            label: "编辑方案",
            icon: "edit",
            disabled: true,
          },
          {
            id: "products",
            label: "配置产品",
            icon: "cube",
            disabled: true,
          },
          {
            id: "toggle-status",
            label: solution.status === "active" ? "停用方案" : "启用方案",
            icon: solution.status === "active" ? "x" : "check",
            disabled: true,
          },
        ]}
      />
    </div>
  );
}

function CapabilityTags({
  products,
  maxVisible = 3,
}: {
  products: ProductSolutionCapability[];
  maxVisible?: number;
}) {
  const visibleProducts = products.slice(0, maxVisible);
  const hiddenCount = Math.max(0, products.length - visibleProducts.length);

  return (
    <span className="vx-product-solution-capability-tags">
      {visibleProducts.map((product) => (
        <Badge
          key={product.id}
          title={`${capabilityTypeLabel(product.productType)} | ${capabilitySourceLabel(product.source)} | ${product.role}`}
        >
          {product.productName}
        </Badge>
      ))}
      {hiddenCount ? <Badge>+{formatNumber(hiddenCount)}</Badge> : null}
    </span>
  );
}

/**
 * 发布态与可见性走 `StatusBadge`，语气由 `publish-tone.ts` 给；套餐等级仍是 pill
 * （等级是序不是语气，另算）。
 */
function useProductSolutionColumns(
  onOpenDetails: (solutionCode: string) => void,
): DataTableColumn<ProductSolutionRecord>[] {
  return [
    {
      id: "solution",
      header: "业务方案",
      cell: (solution) => (
        <TableTitleCell
          icon="workflow"
          title={solution.solutionName}
          description={`${solution.solutionCode} · ${solution.ownerTeam}`}
          onTitleClick={() => onOpenDetails(solution.solutionCode)}
        />
      ),
    },
    {
      id: "scenario",
      header: "行业场景",
      align: "center",
      cell: (solution) => (
        <TableTitleCell
          title={
            <span className="inline-flex flex-wrap justify-center gap-2xs">
              <StatusBadge tone={PUBLISH_STATUS_TONE[solution.status]}>
                {solutionStatusLabel(solution.status)}
              </StatusBadge>
              <StatusBadge tone={VISIBILITY_TONE[solution.visibility]}>
                {solutionVisibilityLabel(solution.visibility)}
              </StatusBadge>
            </span>
          }
          description={`${solution.industry} | ${solution.scenario}`}
        />
      ),
    },
    {
      id: "products",
      header: "产品能力",
      cell: (solution) => (
        <TableTitleCell
          title={<CapabilityTags products={solution.products} />}
          description={`${formatNumber(solution.products.length)} 产品能力 | 三方 ${formatNumber(
            solution.products.filter((product) => product.source === "partner")
              .length,
          )}`}
        />
      ),
    },
    {
      id: "tiers",
      header: "服务套餐",
      align: "center",
      cell: (solution) => (
        <TableTitleCell
          title={
            <span className="inline-flex flex-wrap justify-center gap-2xs">
              {solution.tiers.map((tier) => (
                <Badge
                  key={tier.tierCode}
                  className={tierBadgeClass(tier.tierCode)}
                  title={tier.summary}
                >
                  {tier.tierName}
                </Badge>
              ))}
            </span>
          }
          description={`${formatNumber(solution.tiers.length)} 个版本 | ${formatDate(solution.updatedAt)} 更新`}
        />
      ),
    },
    {
      id: "operation",
      header: "运营",
      align: "right",
      cell: (solution) => (
        <TableTitleCell
          title={formatMoney(solution.monthlyRevenue)}
          description={`${formatNumber(solution.subscriptionCount)} 订阅 | 活跃 ${formatNumber(solution.activeTenantCount)}`}
        />
      ),
    },
  ];
}

function ProductSolutionCards({
  solutions,
  onOpenDetails,
}: {
  solutions: ProductSolutionRecord[];
  onOpenDetails: (solutionCode: string) => void;
}) {
  return (
    <div
      className="vx-tenant-directory-cards vx-product-solution-cards"
      aria-label="解决方案卡片"
    >
      {solutions.map((solution) => (
        <article
          key={solution.id}
          className={joinClasses(
            "vx-tenant-directory-card",
            `vx-product-solution-card--${solution.status}`,
          )}
          role="button"
          tabIndex={0}
          onClick={() => onOpenDetails(solution.solutionCode)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onOpenDetails(solution.solutionCode);
          }}
        >
          <header>
            <Icon name="workflow" size="lg" fallback="placeholder" />
            <div>
              <strong>{solution.solutionName}</strong>
              <span>
                {solution.solutionCode} · {solution.industry}
              </span>
            </div>
            <ProductSolutionActionsMenu
              solution={solution}
              onViewDetails={() => onOpenDetails(solution.solutionCode)}
            />
          </header>
          <div className="vx-tenant-directory-card__badges">
            <StatusBadge tone={PUBLISH_STATUS_TONE[solution.status]}>
              {solutionStatusLabel(solution.status)}
            </StatusBadge>
            <StatusBadge tone={VISIBILITY_TONE[solution.visibility]}>
              {solutionVisibilityLabel(solution.visibility)}
            </StatusBadge>
          </div>
          <p className="vx-product-solution-card__description">
            {solution.description}
          </p>
          <div className="vx-product-solution-card__capabilities">
            {solution.products.map((product) => (
              <span key={product.id}>
                <Icon
                  name={capabilityTypeIcon(product.productType)}
                  size="xs"
                  fallback="placeholder"
                />
                {product.productName}
              </span>
            ))}
          </div>
          <div className="vx-tenant-directory-card__metrics">
            <span>
              <b>{formatNumber(solution.products.length)}</b>
              <small>产品能力</small>
            </span>
            <span>
              <b>{formatNumber(solution.tiers.length)}</b>
              <small>套餐版本</small>
            </span>
            <span>
              <b>{formatNumber(solution.subscriptionCount)}</b>
              <small>订阅</small>
            </span>
          </div>
          <footer>
            <span>{solution.customerSegment}</span>
            <strong>{formatMoney(solution.monthlyRevenue)}</strong>
          </footer>
        </article>
      ))}
    </div>
  );
}

export function ProductSolutionsPage() {
  const tShared = useTranslations();
  const router = useRouter();
  const [solutions, setSolutions] = useState<ProductSolutionRecord[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedSolutionIds, setSelectedSolutionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] =
    useState<VisibilityFilter>("all");
  const [industryFilter, setIndustryFilter] = useState<IndustryFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchProductSolutions()
      .then((records) => {
        if (!active) return;
        setSolutions(records);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const industries = useMemo(
    () =>
      Array.from(new Set(solutions.map((solution) => solution.industry))).sort(
        (left, right) => left.localeCompare(right, "zh-CN"),
      ),
    [solutions],
  );
  const solutionColumns = useProductSolutionColumns(handleOpenDetails);

  const filteredSolutions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return solutions.filter((solution) => {
      if (statusFilter !== "all" && solution.status !== statusFilter)
        return false;
      if (
        visibilityFilter !== "all" &&
        solution.visibility !== visibilityFilter
      )
        return false;
      if (industryFilter !== "all" && solution.industry !== industryFilter)
        return false;
      if (
        sourceFilter !== "all" &&
        !solution.products.some((product) => product.source === sourceFilter)
      )
        return false;
      if (
        normalizedQuery &&
        !solutionSearchText(solution).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [
    industryFilter,
    query,
    solutions,
    sourceFilter,
    statusFilter,
    visibilityFilter,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredSolutions.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleSolutions = filteredSolutions.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const activeSolutions = solutions.filter(
    (solution) => solution.status === "active",
  ).length;
  const productCount = solutions.reduce(
    (sum, solution) => sum + solution.products.length,
    0,
  );
  const partnerProductCount = solutions.reduce(
    (sum, solution) =>
      sum +
      solution.products.filter((product) => product.source === "partner")
        .length,
    0,
  );
  const tierCount = solutions.reduce(
    (sum, solution) => sum + solution.tiers.length,
    0,
  );
  const subscriptionCount = solutions.reduce(
    (sum, solution) => sum + solution.subscriptionCount,
    0,
  );
  const monthlyRevenue = solutions.reduce(
    (sum, solution) => sum + solution.monthlyRevenue,
    0,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [
    industryFilter,
    pageSize,
    query,
    sourceFilter,
    statusFilter,
    visibilityFilter,
    viewMode,
  ]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setVisibilityFilter("all");
    setIndustryFilter("all");
    setSourceFilter("all");
  }

  function handleOpenDetails(solutionCode: string) {
    router.push(`/product-solutions/${encodeURIComponent(solutionCode)}`);
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-product-solutions-page"
        header={
          <PageHeader
            icon="workflow"
            title="解决方案"
            description="按行业业务场景组合产品能力，定义方案边界、包含产品、服务套餐和适用客户。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="解决方案统计"
              items={[
                {
                  id: "total",
                  help: "业务方案总数。",
                  icon: "workflow",
                  label: "方案总数",
                  value: formatNumber(solutions.length),
                  tags: [`启用 ${formatNumber(activeSolutions)}`],
                },
                {
                  id: "products",
                  help: "各方案关联的产品能力条目之和（跨方案不去重）。",
                  icon: "cube",
                  label: "产品能力",
                  value: formatNumber(productCount),
                  tags: [`三方 ${formatNumber(partnerProductCount)}`],
                  tone: "success",
                },
                {
                  id: "tiers",
                  help: "各方案下服务套餐数之和。",
                  icon: "star",
                  label: "服务套餐",
                  value: formatNumber(tierCount),
                  tags: [`订阅 ${formatNumber(subscriptionCount)}`],
                  tone: "warning",
                },
                {
                  id: "revenue",
                  help: "各方案月度收入之和。",
                  icon: "chart-bar",
                  label: "月度收入",
                  value: formatMoney(monthlyRevenue),
                  tags: [`场景 ${formatNumber(industries.length)}`],
                  tone: "brand",
                },
              ]}
            />
          </>
        }
        filters={
          <FilterBar
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredSolutions.length)}
            aria-label="解决方案筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索方案、行业、产品能力"
                className="vx-tenant-search vx-product-solution-search"
                aria-label="搜索解决方案"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton variant="outline" icon="plus" disabled>
                  新建方案
                </ActionButton>
              </>
            }
          >
            <div className="vx-tenant-filters">
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="方案状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">{tShared("actions.enable")}</option>
                <option value="draft">{tShared("status.generic.draft")}</option>
                <option value="archived">{tShared("actions.archive")}</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={visibilityFilter}
                onChange={(event) =>
                  setVisibilityFilter(event.target.value as VisibilityFilter)
                }
                aria-label="可见范围"
              >
                <option value="all">全部范围</option>
                <option value="public">公开</option>
                <option value="internal">内部</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select vx-product-solution-select--industry"
                value={industryFilter}
                onChange={(event) => setIndustryFilter(event.target.value)}
                aria-label="行业场景"
              >
                <option value="all">全部行业</option>
                {industries.map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(event.target.value as SourceFilter)
                }
                aria-label="产品来源"
              >
                <option value="all">全部来源</option>
                <option value="self">自建</option>
                <option value="partner">三方</option>
              </NativeSelect>
            </div>
          </FilterBar>
        }
        table={
          <section className="vx-tenant-directory" aria-label="解决方案清单">
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="vx-tenant-directory__header">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={solutionColumns}
                rows={visibleSolutions}
                rowKey={(solution) => solution.id}
                loading={loading}
                indexStart={(activePage - 1) * pageSize + 1}
                selectedKeys={[...selectedSolutionIds]}
                onSelectionChange={(keys) =>
                  setSelectedSolutionIds(new Set(keys))
                }
                rowActions={(solution) => (
                  <ProductSolutionActionsMenu
                    solution={solution}
                    onViewDetails={() =>
                      handleOpenDetails(solution.solutionCode)
                    }
                  />
                )}
                empty={
                  <EmptyState
                    title="没有匹配的解决方案"
                    description="清空筛选条件后可查看全部解决方案。"
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
            ) : visibleSolutions.length ? (
              <ProductSolutionCards
                solutions={visibleSolutions}
                onOpenDetails={handleOpenDetails}
              />
            ) : (
              <EmptyState
                title={loading ? "正在加载解决方案" : "没有匹配的解决方案"}
                description={
                  loading
                    ? "正在读取行业解决方案数据。"
                    : "清空筛选条件后可查看全部解决方案。"
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
            total={filteredSolutions.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />
    </>
  );
}
