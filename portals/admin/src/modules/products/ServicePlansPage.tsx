"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  ListCardGrid,
  ListPageTemplate,
  MetricGrid,
  MetricListCard,
  NativeSelect,
  PanelItem,
  PanelList,
  StatusBadge,
  TableTitleCell,
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
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  formatDate,
  formatMoney,
  formatNumber,
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
  const tShared = useTranslations();
  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${item.solution.solutionName} ${item.tier.tierName} 操作`}
        items={[
          {
            id: "details",
            label: tShared("actions.viewDetail"),
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
  const priceNote =
    priceKind === "free"
      ? "试用版本"
      : priceKind === "contract"
        ? "专属商务"
        : "标准定价";
  const badges = (
    <>
      <StatusBadge tone={PUBLISH_STATUS_TONE[item.tier.status]}>
        {tierStatusLabel(item.tier.status)}
      </StatusBadge>
      <StatusBadge tone={item.tier.isPublic ? "success" : "neutral"}>
        {item.tier.isPublic ? "公开" : "内部"}
      </StatusBadge>
    </>
  );
  const productTags = (
    <span className="flex min-w-0 flex-nowrap items-center gap-xs overflow-hidden">
      {products.map((product) => (
        <Badge key={product.id} title={product.role}>
          {product.productName}
        </Badge>
      ))}
      {hiddenProductCount ? (
        <Badge>+{formatNumber(hiddenProductCount)}</Badge>
      ) : null}
    </span>
  );

  /* 卡片与行原本是两套手搓 grid，四个内容块靠 `grid-column` 在两套里各摆一遍。
     现在内容只组织一次，版式交给两个 DS 件。 */
  if (viewMode === "cards") {
    return (
      <MetricListCard
        icon="star"
        title={item.tier.tierName}
        description={`${item.solution.solutionCode} · ${item.tier.tierCode}`}
        tone={PUBLISH_STATUS_TONE[item.tier.status]}
        actions={
          <ServicePlanActionsMenu item={item} onViewDetails={onViewDetails} />
        }
        badges={badges}
        note={
          <>
            <p
              className="m-0 truncate text-body-sm text-foreground"
              title={item.tier.summary}
            >
              {item.tier.summary}
            </p>
            {productTags}
          </>
        }
        metrics={[
          { key: "price", value: tierPriceLabel(item), label: priceNote },
          {
            key: "base",
            value: item.basePlan?.planName ?? "独立配置",
            label: "基础套餐",
          },
        ]}
        onClick={onViewDetails}
      />
    );
  }

  return (
    <PanelItem
      className="rounded-md transition-colors hover:bg-primary-muted/40"
      lead={<Icon name="star" size="sm" fallback="placeholder" />}
      main={
        /* 点击目标是标题本身（`TableTitleCell` 的 `onTitleClick` 就渲染成可点
           标题），不是整行拉伸链接：这一行的 trail 里已经有徽章、产品标和一个
           行操作菜单，整行热区会把它们全盖住。 */
        <TableTitleCell
          title={item.tier.tierName}
          description={`${item.solution.solutionCode} · ${item.tier.tierCode}`}
          onTitleClick={onViewDetails}
        />
      }
      trail={
        <span className="flex items-center gap-md">
          {badges}
          {productTags}
          <span className="grid justify-items-end gap-2xs">
            <span className="text-body-md font-semibold text-foreground">
              {tierPriceLabel(item)}
            </span>
            <span className="whitespace-nowrap text-body-sm text-muted-foreground">
              {priceNote}
            </span>
          </span>
          <ServicePlanActionsMenu item={item} onViewDetails={onViewDetails} />
        </span>
      }
    />
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
  const locale = useLocale();
  const partnerProductCount = group.solution.products.filter(
    (product) => product.source === "partner",
  ).length;

  return (
    <section className="grid min-w-0 gap-md border-b border-dashed border-primary/10 pt-md last:border-b-0">
      <DetailSummaryHeader
        icon="workflow"
        title={group.solution.solutionName}
        subtitle={
          <>
            {group.solution.industry} | {group.solution.scenario}
          </>
        }
        aside={
          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-xs">
            <StatusBadge tone={PUBLISH_STATUS_TONE[group.solution.status]}>
              {tierStatusLabel(group.solution.status)}
            </StatusBadge>
            <StatusBadge tone={VISIBILITY_TONE[group.solution.visibility]}>
              {solutionVisibilityLabel(group.solution.visibility)}
            </StatusBadge>
          </div>
        }
      />

      <div className="flex min-w-0 flex-wrap items-center gap-x-md gap-y-sm text-body-sm text-muted-foreground [&>span]:whitespace-nowrap">
        <span>{formatNumber(group.solution.products.length)} 产品能力</span>
        <span>三方 {formatNumber(partnerProductCount)}</span>
        <span>{formatNumber(group.tiers.length)} 套餐版本</span>
        <span>{formatNumber(group.solution.subscriptionCount)} 订阅</span>
        <span>{formatMoney(group.solution.monthlyRevenue)} / 月</span>
        <span>{formatDate(group.solution.updatedAt, locale)} 更新</span>
      </div>

      {viewMode === "cards" ? (
        <ListCardGrid>
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
        </ListCardGrid>
      ) : (
        <PanelList>
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
        </PanelList>
      )}
    </section>
  );
}

export function ServicePlansPage() {
  const tShared = useTranslations();
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
        className="w-full"
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
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={formatNumber(filteredTierItems.length)}
            aria-label="服务套餐筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索方案、套餐、配额"
                className="grow basis-media-3xl max-w-panel-sm"
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
            <>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="套餐状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">{tShared("actions.enable")}</option>
                <option value="draft">{tShared("status.generic.draft")}</option>
                <option value="archived">{tShared("actions.archive")}</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
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
                wrapperClassName="w-fit basis-media-xl"
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
                wrapperClassName="w-fit basis-media-xl"
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
            </>
          </FilterBar>
        }
        table={
          <section className="grid min-w-0 gap-xs" aria-label="服务套餐清单">
            {loading ? (
              <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
                <span>{tShared("common.loading")}</span>
              </header>
            ) : null}

            {visibleGroups.length ? (
              <div className="grid min-w-0 gap-lg border-t border-primary/15 pt-2xs">
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
