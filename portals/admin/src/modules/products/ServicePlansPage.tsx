"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  ListPageTemplate,
  MetricGrid,
  StatusBadge,
  NativeSelect,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { fetchProductPlans, fetchProductSolutions } from "@/api/admin-bff";
import type {
  ProductPlanRecord,
  ProductSolutionRecord,
  ProductSolutionStatus,
  ProductSolutionTier,
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
type VisibilityFilter = "all" | "public" | "internal";
type PriceFilter = "all" | "free" | "paid" | "contract";
type IndustryFilter = "all" | string;

const tierPlanCodeMap: Record<ProductSolutionTier["tierCode"], string> = {
  free: "starter",
  pro: "growth",
  enterprise: "enterprise",
  custom: "enterprise",
};

interface ServicePlanTierItem {
  id: string;
  solution: ProductSolutionRecord;
  tier: ProductSolutionTier;
  basePlan: ProductPlanRecord | null;
}

interface ServicePlanGroup {
  solution: ProductSolutionRecord;
  tiers: ServicePlanTierItem[];
}

function tierStatusLabel(status: ProductSolutionStatus) {
  if (status === "active") return "启用";
  if (status === "draft") return "草稿";
  return "归档";
}

function solutionVisibilityLabel(
  visibility: ProductSolutionRecord["visibility"],
) {
  return visibility === "public" ? "公开" : "内部";
}

function tierPriceKind(tier: ProductSolutionTier): PriceFilter {
  if (tier.tierCode === "free") return "free";
  if (tier.tierCode === "enterprise" || tier.tierCode === "custom")
    return "contract";
  return "paid";
}

function defaultPrice(plan: ProductPlanRecord | null) {
  if (!plan) return null;
  return (
    plan.prices.find((price) => price.isDefault && price.isActive) ??
    plan.prices.find((price) => price.isActive) ??
    plan.prices[0] ??
    null
  );
}

function tierPriceLabel(item: ServicePlanTierItem) {
  const priceKind = tierPriceKind(item.tier);
  if (priceKind === "free") return "免费";
  if (priceKind === "contract") return "合同报价";

  const price = defaultPrice(item.basePlan);
  if (!price) return "待定价";

  return `${formatMoney(price.price)} / ${price.periodType === "yearly" ? "年" : "月"}`;
}

function tierSearchText(item: ServicePlanTierItem) {
  return [
    item.solution.solutionCode,
    item.solution.solutionName,
    item.solution.description,
    item.solution.industry,
    item.solution.scenario,
    item.solution.customerSegment,
    item.tier.tierCode,
    item.tier.tierName,
    item.tier.summary,
    item.tier.status,
    item.basePlan?.planCode,
    item.basePlan?.planName,
    ...item.solution.products.map(
      (product) =>
        `${product.productCode} ${product.productName} ${product.role}`,
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildTierItems(
  solutions: ProductSolutionRecord[],
  plans: ProductPlanRecord[],
) {
  const plansByCode = new Map(plans.map((plan) => [plan.planCode, plan]));

  return solutions.flatMap((solution) =>
    solution.tiers.map((tier) => ({
      id: `${solution.id}:${tier.tierCode}`,
      solution,
      tier,
      basePlan: plansByCode.get(tierPlanCodeMap[tier.tierCode]) ?? null,
    })),
  );
}

function groupTierItems(items: ServicePlanTierItem[]) {
  const groups = new Map<string, ServicePlanGroup>();

  for (const item of items) {
    const group = groups.get(item.solution.id) ?? {
      solution: item.solution,
      tiers: [],
    };
    group.tiers.push(item);
    groups.set(item.solution.id, group);
  }

  return Array.from(groups.values());
}

function ServicePlanActionsMenu({
  item,
  onViewDetails,
}: {
  item: ServicePlanTierItem;
  onViewDetails: () => void;
}) {
  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${item.solution.solutionName} ${item.tier.tierName} 操作`}
        items={[
          {
            id: "details",
            label: "查看详情",
            icon: "arrow-right",
            onSelect: onViewDetails,
          },
          {
            id: "quota",
            label: "配额配置",
            icon: "chart-bar",
            disabled: true,
          },
          {
            id: "price",
            label: "价格配置",
            icon: "edit",
            disabled: true,
          },
          {
            id: "toggle-status",
            label: item.tier.status === "active" ? "下架套餐" : "上架套餐",
            icon: item.tier.status === "active" ? "x" : "check",
            disabled: true,
          },
        ]}
      />
    </div>
  );
}

function ServicePlanTier({
  item,
  viewMode,
  onViewDetails,
}: {
  item: ServicePlanTierItem;
  viewMode: ViewMode;
  onViewDetails: () => void;
}) {
  const priceKind = tierPriceKind(item.tier);
  const products = item.solution.products.slice(0, 3);
  const hiddenProductCount = Math.max(
    0,
    item.solution.products.length - products.length,
  );
  const className = joinClasses(
    viewMode === "cards"
      ? "vx-service-plan-tier-card"
      : "vx-service-plan-tier-row",
    `vx-service-plan-tier--${item.tier.status}`,
  );

  return (
    <article
      className={className}
      role="button"
      tabIndex={0}
      onClick={onViewDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter") onViewDetails();
      }}
    >
      <div className="vx-service-plan-tier__identity">
        <Icon
          name="star"
          size={viewMode === "cards" ? "lg" : "sm"}
          fallback="placeholder"
        />
        <span>
          <strong>{item.tier.tierName}</strong>
          <small>
            {item.solution.solutionCode} · {item.tier.tierCode}
          </small>
        </span>
      </div>

      <div className="vx-service-plan-tier__status">
        <span className="vx-service-plan-tag-line">
          <StatusBadge tone={PUBLISH_STATUS_TONE[item.tier.status]}>
            {tierStatusLabel(item.tier.status)}
          </StatusBadge>
          <StatusBadge tone={item.tier.isPublic ? "success" : "neutral"}>
            {item.tier.isPublic ? "公开" : "内部"}
          </StatusBadge>
        </span>
        <small>{item.basePlan?.planName ?? "独立配置"}</small>
      </div>

      <div className="vx-service-plan-tier__summary">
        <p title={item.tier.summary}>{item.tier.summary}</p>
        <span className="vx-service-plan-product-tags">
          {products.map((product) => (
            <Badge key={product.id} title={product.role}>
              {product.productName}
            </Badge>
          ))}
          {hiddenProductCount ? (
            <Badge>+{formatNumber(hiddenProductCount)}</Badge>
          ) : null}
        </span>
      </div>

      <div className="vx-service-plan-tier__price">
        <strong>{tierPriceLabel(item)}</strong>
        <small>
          {priceKind === "free"
            ? "试用版本"
            : priceKind === "contract"
              ? "专属商务"
              : "标准定价"}
        </small>
      </div>

      <ServicePlanActionsMenu item={item} onViewDetails={onViewDetails} />
    </article>
  );
}

function ServicePlanGroupBlock({
  group,
  viewMode,
  onOpenDetails,
}: {
  group: ServicePlanGroup;
  viewMode: ViewMode;
  onOpenDetails: (
    solutionCode: string,
    tierCode: ProductSolutionTier["tierCode"],
  ) => void;
}) {
  const partnerProductCount = group.solution.products.filter(
    (product) => product.source === "partner",
  ).length;

  return (
    <section className="vx-service-plan-group">
      <header className="vx-service-plan-group__header">
        <div className="vx-service-plan-group__identity">
          <Icon name="workflow" size="lg" fallback="placeholder" />
          <div>
            <h2>{group.solution.solutionName}</h2>
            <p>
              {group.solution.industry} | {group.solution.scenario}
            </p>
          </div>
        </div>
        <div className="vx-service-plan-group__badges">
          <StatusBadge tone={PUBLISH_STATUS_TONE[group.solution.status]}>
            {tierStatusLabel(group.solution.status)}
          </StatusBadge>
          <StatusBadge tone={VISIBILITY_TONE[group.solution.visibility]}>
            {solutionVisibilityLabel(group.solution.visibility)}
          </StatusBadge>
        </div>
      </header>

      <div className="vx-service-plan-group__meta">
        <span>{formatNumber(group.solution.products.length)} 产品能力</span>
        <span>三方 {formatNumber(partnerProductCount)}</span>
        <span>{formatNumber(group.tiers.length)} 套餐版本</span>
        <span>{formatNumber(group.solution.subscriptionCount)} 订阅</span>
        <span>{formatMoney(group.solution.monthlyRevenue)} / 月</span>
        <span>{formatDate(group.solution.updatedAt)} 更新</span>
      </div>

      <div
        className={
          viewMode === "cards"
            ? "vx-service-plan-tier-grid"
            : "vx-service-plan-tier-list"
        }
      >
        {group.tiers.map((item) => (
          <ServicePlanTier
            key={item.id}
            item={item}
            viewMode={viewMode}
            onViewDetails={() =>
              onOpenDetails(item.solution.solutionCode, item.tier.tierCode)
            }
          />
        ))}
      </div>
    </section>
  );
}

export function ServicePlansPage() {
  const router = useRouter();
  const [solutions, setSolutions] = useState<ProductSolutionRecord[]>([]);
  const [plans, setPlans] = useState<ProductPlanRecord[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] =
    useState<VisibilityFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [industryFilter, setIndustryFilter] = useState<IndustryFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([fetchProductSolutions(), fetchProductPlans()])
      .then(([solutionRecords, planRecords]) => {
        if (!active) return;
        setSolutions(solutionRecords);
        setPlans(planRecords);
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
  const tierItems = useMemo(
    () => buildTierItems(solutions, plans),
    [plans, solutions],
  );
  const filteredTierItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tierItems.filter((item) => {
      if (statusFilter !== "all" && item.tier.status !== statusFilter)
        return false;
      if (
        visibilityFilter !== "all" &&
        item.solution.visibility !== visibilityFilter
      )
        return false;
      if (industryFilter !== "all" && item.solution.industry !== industryFilter)
        return false;
      if (priceFilter !== "all" && tierPriceKind(item.tier) !== priceFilter)
        return false;
      if (normalizedQuery && !tierSearchText(item).includes(normalizedQuery))
        return false;
      return true;
    });
  }, [
    industryFilter,
    priceFilter,
    query,
    statusFilter,
    tierItems,
    visibilityFilter,
  ]);
  const filteredGroups = useMemo(
    () => groupTierItems(filteredTierItems),
    [filteredTierItems],
  );
  const pageCount = Math.max(1, Math.ceil(filteredGroups.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleGroups = filteredGroups.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const activeTierCount = tierItems.filter(
    (item) => item.tier.status === "active",
  ).length;
  const publicTierCount = tierItems.filter((item) => item.tier.isPublic).length;
  const solutionCount = solutions.length;
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
    priceFilter,
    query,
    statusFilter,
    visibilityFilter,
    viewMode,
  ]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setVisibilityFilter("all");
    setPriceFilter("all");
    setIndustryFilter("all");
  }

  function handleOpenDetails(
    solutionCode: string,
    tierCode: ProductSolutionTier["tierCode"],
  ) {
    router.push(
      `/service-plans/${encodeURIComponent(solutionCode)}/${encodeURIComponent(tierCode)}`,
    );
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-service-plans-page"
        header={
          <PageHeader
            icon="star"
            title="服务套餐"
            description="按解决方案铺开 Free / Pro / Enterprise 等服务套餐，维护配额、价格、售卖状态和适用范围。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="服务套餐管理统计"
              items={[
                {
                  id: "solutions",
                  help: "提供服务套餐的业务方案数。",
                  icon: "workflow",
                  label: "业务方案",
                  value: formatNumber(solutionCount),
                  tags: [`套餐 ${formatNumber(tierItems.length)}`],
                },
                {
                  id: "active-tiers",
                  help: "状态为启用、可被订阅的套餐数。",
                  icon: "star",
                  label: "启用套餐",
                  value: formatNumber(activeTierCount),
                  tags: [`公开 ${formatNumber(publicTierCount)}`],
                  tone: "success",
                },
                {
                  id: "subscriptions",
                  help: "各方案的订阅数之和。",
                  icon: "user",
                  label: "订阅使用",
                  value: formatNumber(subscriptionCount),
                  tags: [`场景 ${formatNumber(industries.length)}`],
                  tone: "warning",
                },
                {
                  id: "revenue",
                  help: "各方案月度收入之和。",
                  icon: "chart-bar",
                  label: "月度收入",
                  value: formatMoney(monthlyRevenue),
                  tags: ["方案口径"],
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
            cardsDisabledReason="卡片视图已停用：列表视图提供选择、排序、分页与跨页批量，运营台的清单是拿来扫读和对比的。"
            count={formatNumber(filteredTierItems.length)}
            aria-label="服务套餐筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索方案、套餐、配额"
                className="vx-tenant-search vx-service-plan-search"
                aria-label="搜索服务套餐"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton variant="outline" icon="plus" disabled>
                  新建套餐
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
                aria-label="套餐状态"
              >
                <option value="all">全部状态</option>
                <option value="active">启用</option>
                <option value="draft">草稿</option>
                <option value="archived">归档</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={priceFilter}
                onChange={(event) =>
                  setPriceFilter(event.target.value as PriceFilter)
                }
                aria-label="价格类型"
              >
                <option value="all">全部价格</option>
                <option value="free">免费</option>
                <option value="paid">标准付费</option>
                <option value="contract">合同报价</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={visibilityFilter}
                onChange={(event) =>
                  setVisibilityFilter(event.target.value as VisibilityFilter)
                }
                aria-label="适用范围"
              >
                <option value="all">全部范围</option>
                <option value="public">公开</option>
                <option value="internal">内部</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select vx-service-plan-select--industry"
                value={industryFilter}
                onChange={(event) => setIndustryFilter(event.target.value)}
                aria-label="业务方案"
              >
                <option value="all">全部行业</option>
                {industries.map((industry) => (
                  <option key={industry} value={industry}>
                    {industry}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </FilterBar>
        }
        table={
          <section
            className="vx-service-plan-directory"
            aria-label="服务套餐清单"
          >
            {loading ? (
              <header className="vx-tenant-directory__header">
                <span>读取中</span>
              </header>
            ) : null}

            {visibleGroups.length ? (
              <div className="vx-service-plan-groups">
                {visibleGroups.map((group) => (
                  <ServicePlanGroupBlock
                    key={group.solution.id}
                    group={group}
                    viewMode={viewMode}
                    onOpenDetails={handleOpenDetails}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title={loading ? "正在加载服务套餐" : "没有匹配的服务套餐"}
                description={
                  loading
                    ? "正在读取业务方案和套餐版本。"
                    : "清空筛选条件后可查看全部服务套餐。"
                }
                action={
                  <ActionButton
                    variant="outline"
                    icon="x"
                    onClick={handleReset}
                  >
                    清空筛选
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
            // 这一页数的是两样东西，`total` + `unit` 说不了。
            countLabel={`共 ${formatNumber(filteredGroups.length)} 个方案，${formatNumber(filteredTierItems.length)} 个套餐`}
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
