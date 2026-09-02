"use client";

/**
 * ServicePlansPage —— 服务套餐 = 方案 × 已绑定档位（product.solution_plans，2026-08-31 去 mock）。
 *
 * 一行 = 方案某个档位上绑的既有 plan。价格、状态、可见性都是那个 plan 自己的；
 * 这页只读 `GET /api/products/solutions`（tiers 已带 priceLabel / priceKind），不再
 * 拉 `/plans` 再按一张写死的 tier→plan_code 表去配——那张表就是 mock 时代的东西。
 * 绑定 / 解绑在方案详情页做；套餐本身的价格与配额在「套餐版本」页改。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  Button,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  PanelItem,
  PanelList,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { fetchProductSolutions } from "@/api/admin-bff";
import type {
  ProductSolutionRecord,
  ProductSolutionStatus,
  ProductSolutionTier,
} from "@/entities/console";
import {
  SOLUTION_STATUS_TONE,
  VISIBILITY_TONE,
} from "@/modules/shared/publish-tone";
import { tierBadgeClass } from "@/modules/shared/tier-level";
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import {
  formatDate,
  formatMoney,
  formatNumber,
} from "@/modules/tenants/tenant-utils";
import { SOLUTION_STATUSES, useSolutionLabels } from "./solution-labels";

type StatusFilter = "all" | ProductSolutionStatus;
type VisibilityFilter = "all" | "public" | "internal";
type PriceFilter = "all" | ProductSolutionTier["priceKind"];
type IndustryFilter = "all" | string;

interface ServicePlanTierItem {
  id: string;
  solution: ProductSolutionRecord;
  tier: ProductSolutionTier;
}

interface ServicePlanGroup {
  solution: ProductSolutionRecord;
  tiers: ServicePlanTierItem[];
}

function tierSearchText(item: ServicePlanTierItem) {
  return [
    item.solution.solutionCode,
    item.solution.solutionName,
    item.solution.industry,
    item.solution.scenario,
    item.tier.tierCode,
    item.tier.tierName,
    item.tier.planCode,
    item.tier.summary,
    ...item.solution.products.map(
      (product) => `${product.productCode} ${product.productName}`,
    ),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildTierItems(solutions: ProductSolutionRecord[]) {
  return solutions.flatMap((solution) =>
    solution.tiers.map((tier) => ({
      id: `${solution.id}:${tier.tierCode}`,
      solution,
      tier,
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

function ServicePlanTierRow({
  item,
  onViewDetails,
  onViewSolution,
}: {
  item: ServicePlanTierItem;
  onViewDetails: () => void;
  onViewSolution: () => void;
}) {
  const t = useTranslations("servicePlansPage");
  const tShared = useTranslations();
  const labels = useSolutionLabels();
  const products = item.solution.products.slice(0, 3);
  const hiddenProductCount = Math.max(
    0,
    item.solution.products.length - products.length,
  );

  return (
    <PanelItem
      className="rounded-md transition-colors hover:bg-primary-muted/40"
      lead={<Icon name="star" size="sm" fallback="placeholder" />}
      main={
        <TableTitleCell
          title={
            <span className="inline-flex items-center gap-xs">
              <Badge className={tierBadgeClass(item.tier.tierCode)}>
                {labels.tier(item.tier.tierCode)}
              </Badge>
              {item.tier.tierName}
            </span>
          }
          description={`${item.solution.solutionCode} · ${item.tier.planCode}`}
          onTitleClick={onViewDetails}
        />
      }
      trail={
        <span className="flex items-center gap-md">
          <StatusBadge tone={SOLUTION_STATUS_TONE[item.tier.status]}>
            {labels.status(item.tier.status)}
          </StatusBadge>
          <StatusBadge tone={item.tier.isPublic ? "success" : "neutral"}>
            {labels.visibility(item.tier.isPublic ? "public" : "internal")}
          </StatusBadge>
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
          <span className="grid justify-items-end gap-2xs">
            <span className="text-body-md font-semibold text-foreground">
              {item.tier.priceLabel}
            </span>
            <span className="whitespace-nowrap text-body-sm text-muted-foreground">
              {labels.priceKind(item.tier.priceKind)}
            </span>
          </span>
          <div
            className="relative z-[1] inline-flex justify-self-end"
            onClick={(event) => event.stopPropagation()}
          >
            <ActionMenu
              label={t("actions.menuLabel", {
                solution: item.solution.solutionName,
                tier: item.tier.tierName,
              })}
              items={[
                {
                  id: "details",
                  label: tShared("actions.viewDetail"),
                  icon: "arrow-right",
                  onSelect: onViewDetails,
                },
                {
                  id: "solution",
                  label: t("actions.viewSolution"),
                  icon: "workflow",
                  onSelect: onViewSolution,
                },
              ]}
            />
          </div>
        </span>
      }
    />
  );
}

function ServicePlanGroupBlock({
  group,
  onOpenDetails,
  onOpenSolution,
}: {
  group: ServicePlanGroup;
  onOpenDetails: (solutionCode: string, tierCode: string) => void;
  onOpenSolution: (solutionCode: string) => void;
}) {
  const t = useTranslations("servicePlansPage");
  const labels = useSolutionLabels();
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
          [group.solution.industry, group.solution.scenario]
            .filter(Boolean)
            .join(" | ") || group.solution.solutionCode
        }
        aside={
          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-xs">
            <StatusBadge tone={SOLUTION_STATUS_TONE[group.solution.status]}>
              {labels.status(group.solution.status)}
            </StatusBadge>
            <StatusBadge tone={VISIBILITY_TONE[group.solution.visibility]}>
              {labels.visibility(group.solution.visibility)}
            </StatusBadge>
          </div>
        }
      />

      <div className="flex min-w-0 flex-wrap items-center gap-x-md gap-y-sm text-body-sm text-muted-foreground [&>span]:whitespace-nowrap">
        <span>
          {t("group.products", { count: group.solution.products.length })}
        </span>
        <span>{t("group.partner", { count: partnerProductCount })}</span>
        <span>{t("group.tiers", { count: group.tiers.length })}</span>
        <span>
          {t("group.subscriptions", {
            count: group.solution.subscriptionCount,
          })}
        </span>
        <span>
          {t("group.revenue", {
            amount: formatMoney(group.solution.monthlyRevenue),
          })}
        </span>
        <span>
          {t("group.updatedAt", {
            date: formatDate(group.solution.updatedAt, locale),
          })}
        </span>
      </div>

      <PanelList>
        {group.tiers.map((item) => (
          <ServicePlanTierRow
            key={item.id}
            item={item}
            onViewDetails={() =>
              onOpenDetails(item.solution.solutionCode, item.tier.tierCode)
            }
            onViewSolution={() => onOpenSolution(item.solution.solutionCode)}
          />
        ))}
      </PanelList>
    </section>
  );
}

export function ServicePlansPage() {
  const t = useTranslations("servicePlansPage");
  const tShared = useTranslations();
  const labels = useSolutionLabels();
  const router = useRouter();
  const [solutions, setSolutions] = useState<ProductSolutionRecord[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [visibilityFilter, setVisibilityFilter] =
    useState<VisibilityFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [industryFilter, setIndustryFilter] = useState<IndustryFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchProductSolutions()
      .then((records) => {
        if (!active) return;
        setSolutions(records);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSolutions([]);
        setLoadError(
          error instanceof Error && error.message
            ? error.message
            : t("feedback.loadError"),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [t]);

  const industries = useMemo(
    () =>
      Array.from(
        new Set(solutions.map((solution) => solution.industry).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [solutions],
  );
  const tierItems = useMemo(() => buildTierItems(solutions), [solutions]);
  const filteredTierItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tierItems.filter((item) => {
      if (statusFilter !== "all" && item.tier.status !== statusFilter)
        return false;
      if (
        visibilityFilter !== "all" &&
        (item.tier.isPublic ? "public" : "internal") !== visibilityFilter
      )
        return false;
      if (industryFilter !== "all" && item.solution.industry !== industryFilter)
        return false;
      if (priceFilter !== "all" && item.tier.priceKind !== priceFilter)
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
  const subscriptionCount = solutions.reduce(
    (sum, solution) => sum + solution.subscriptionCount,
    0,
  );
  const monthlyRevenue = solutions.reduce(
    (sum, solution) => sum + solution.monthlyRevenue,
    0,
  );
  const hasFilters =
    query.trim().length > 0 ||
    statusFilter !== "all" ||
    visibilityFilter !== "all" ||
    priceFilter !== "all" ||
    industryFilter !== "all";

  useEffect(() => {
    setCurrentPage(1);
  }, [
    industryFilter,
    pageSize,
    priceFilter,
    query,
    statusFilter,
    visibilityFilter,
  ]);

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setVisibilityFilter("all");
    setPriceFilter("all");
    setIndustryFilter("all");
  }

  function handleOpenDetails(solutionCode: string, tierCode: string) {
    router.push(
      `/service-plans/${encodeURIComponent(solutionCode)}/${encodeURIComponent(tierCode)}`,
    );
  }

  function handleOpenSolution(solutionCode: string) {
    router.push(`/product-solutions/${encodeURIComponent(solutionCode)}`);
  }

  /* 三种空态说三件不同的事：读不到 / 一个方案都没有 / 有方案但没绑套餐 / 筛选没命中。 */
  const emptyState = loadError ? (
    <EmptyState
      icon="warning"
      title={t("empty.loadFailedTitle")}
      description={loadError}
    />
  ) : solutions.length === 0 ? (
    <EmptyState
      title={t("empty.noSolutionsTitle")}
      description={t("empty.noSolutionsDescription")}
      action={
        <Button asChild>
          <Link href="/product-solutions">
            <Icon name="workflow" size="xs" fallback="placeholder" />
            {t("actions.goToSolutions")}
          </Link>
        </Button>
      }
    />
  ) : tierItems.length === 0 ? (
    <EmptyState
      title={t("empty.noTiersTitle")}
      description={t("empty.noTiersDescription")}
      action={
        <Button asChild variant="outline">
          <Link href="/product-solutions">
            <Icon name="workflow" size="xs" fallback="placeholder" />
            {t("actions.goToSolutions")}
          </Link>
        </Button>
      }
    />
  ) : (
    <EmptyState
      title={t("empty.filteredTitle")}
      description={t("empty.filteredDescription")}
      action={
        hasFilters ? (
          <ActionButton variant="outline" icon="x" onClick={handleReset}>
            {tShared("common.clearFilters")}
          </ActionButton>
        ) : undefined
      }
    />
  );

  return (
    <ListPageTemplate
      className="w-full"
      header={
        <PageHeader
          icon="star"
          title={t("header.title")}
          description={t("header.description")}
        />
      }
      summary={
        <>
          {loadError ? <Banner tone="danger" title={loadError} /> : null}
          <MetricGrid
            loading={loading}
            aria-label={t("summary.ariaLabel")}
            items={[
              {
                id: "solutions",
                help: t("summary.solutionsHelp"),
                icon: "workflow",
                label: t("summary.solutions"),
                value: formatNumber(solutions.length),
                tags: [t("summary.tiersTag", { count: tierItems.length })],
              },
              {
                id: "active-tiers",
                help: t("summary.activeTiersHelp"),
                icon: "star",
                label: t("summary.activeTiers"),
                value: formatNumber(activeTierCount),
                tags: [t("summary.publicTag", { count: publicTierCount })],
                tone: "success",
              },
              {
                id: "subscriptions",
                help: t("summary.subscriptionsHelp"),
                icon: "user",
                label: t("summary.subscriptions"),
                value: formatNumber(subscriptionCount),
                tags: [
                  t("summary.industriesTag", { count: industries.length }),
                ],
                tone: "warning",
              },
              {
                id: "revenue",
                help: t("summary.revenueHelp"),
                icon: "chart-bar",
                label: t("summary.revenue"),
                value: formatMoney(monthlyRevenue),
                tags: [t("summary.revenueTag")],
                tone: "brand",
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
          count={formatNumber(filteredTierItems.length)}
          aria-label={t("filters.ariaLabel")}
          search={
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("filters.searchPlaceholder")}
              className="grow basis-media-3xl max-w-panel-sm"
              aria-label={t("filters.searchAriaLabel")}
            />
          }
          onReset={handleReset}
          actions={
            <Button asChild variant="outline">
              <Link href="/plan-versions">
                <Icon name="edit" size="xs" fallback="placeholder" />
                {t("actions.planVersions")}
              </Link>
            </Button>
          }
        >
          <>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              aria-label={t("filters.status")}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              {SOLUTION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {labels.status(status)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={priceFilter}
              onChange={(event) =>
                setPriceFilter(event.target.value as PriceFilter)
              }
              aria-label={t("filters.price")}
            >
              <option value="all">{t("filters.allPrices")}</option>
              <option value="free">{labels.priceKind("free")}</option>
              <option value="paid">{labels.priceKind("paid")}</option>
              <option value="contract">{labels.priceKind("contract")}</option>
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={visibilityFilter}
              onChange={(event) =>
                setVisibilityFilter(event.target.value as VisibilityFilter)
              }
              aria-label={t("filters.visibility")}
            >
              <option value="all">{t("filters.allVisibility")}</option>
              <option value="public">{labels.visibility("public")}</option>
              <option value="internal">{labels.visibility("internal")}</option>
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={industryFilter}
              onChange={(event) => setIndustryFilter(event.target.value)}
              aria-label={t("filters.industry")}
            >
              <option value="all">{t("filters.allIndustries")}</option>
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
        <section
          className="grid min-w-0 gap-xs"
          aria-label={t("table.ariaLabel")}
        >
          {loading ? (
            <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
              <span>{tShared("common.loading")}</span>
            </header>
          ) : visibleGroups.length ? (
            <div className="grid min-w-0 gap-lg border-t border-primary/15 pt-2xs">
              {visibleGroups.map((group) => (
                <ServicePlanGroupBlock
                  key={group.solution.id}
                  group={group}
                  onOpenDetails={handleOpenDetails}
                  onOpenSolution={handleOpenSolution}
                />
              ))}
            </div>
          ) : (
            emptyState
          )}
        </section>
      }
      footer={
        <ListPagination
          currentPage={activePage}
          pageCount={pageCount}
          countLabel={t("pagination.summary", {
            solutions: filteredGroups.length,
            tiers: filteredTierItems.length,
          })}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
          onPageChange={(page) =>
            setCurrentPage(Math.min(Math.max(page, 1), pageCount))
          }
        />
      }
    />
  );
}
