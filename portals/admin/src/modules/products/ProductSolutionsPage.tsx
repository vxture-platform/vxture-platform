"use client";

/**
 * ProductSolutionsPage —— 解决方案列表 + 新建方案（product.solutions，2026-08-31 去 mock）。
 *
 * 列表读 `GET /api/products/solutions`（真实计数：绑定套餐的订阅数 / 租户数 / MRR）。
 * 行操作里只放状态迁移；字段、产品、套餐的编辑都在详情页——列表页不开第二套表单。
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  Textarea,
  useToast,
} from "@vxture/design-system";
import type { ActionMenuItem, DataTableColumn } from "@vxture/design-system";
import { TIERS } from "@vxture-platform/shared";
import { tierBadgeClass } from "@/modules/shared/tier-level";
import { ListPagination } from "@/modules/shared/ListPagination";
import {
  createProductSolution,
  deleteProductSolution,
  fetchProductSolutions,
  setProductSolutionState,
} from "@/api/admin-bff";
import { isStepUpCancelled, useStepUp } from "@/providers/StepUpProvider";
import type {
  ProductSolutionCapability,
  ProductSolutionCapabilitySource,
  ProductSolutionRecord,
  ProductSolutionStatus,
  ProductSolutionVisibility,
  ProductSolutionWriteInput,
} from "@/entities/console";
import {
  SOLUTION_STATUS_TONE,
  VISIBILITY_TONE,
} from "@/modules/shared/publish-tone";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { useConfirmLabels } from "@/modules/shared/destructive";
import {
  formatDate,
  formatMoney,
  formatNumber,
} from "@/modules/tenants/tenant-utils";
import {
  SOLUTION_CODE_RE,
  SOLUTION_STATE_TRANSITIONS,
  SOLUTION_STATUSES,
  useSolutionLabels,
} from "./solution-labels";
import { SolutionField } from "./SolutionField";

type StatusFilter = "all" | ProductSolutionStatus;
type VisibilityFilter = "all" | ProductSolutionVisibility;
type IndustryFilter = "all" | string;
type SourceFilter = "all" | ProductSolutionCapabilitySource;

interface CreateForm {
  solutionCode: string;
  solutionName: string;
  industry: string;
  scenario: string;
  customerSegment: string;
  ownerTeam: string;
  description: string;
}

function emptyCreateForm(): CreateForm {
  return {
    solutionCode: "",
    solutionName: "",
    industry: "",
    scenario: "",
    customerSegment: "",
    ownerTeam: "",
    description: "",
  };
}

function createFormIsValid(form: CreateForm) {
  return (
    SOLUTION_CODE_RE.test(form.solutionCode.trim()) &&
    form.solutionName.trim().length > 0
  );
}

/**
 * 归一化方案编码——把从文档/编辑器粘来的"假连字符"(U+2010–2015 各类连字符、
 * U+2212 减号、全角 U+FF0D)与空格都收成 ASCII `-`,并转小写。owner 2026-08-31
 * 粘的 `solution‑drone‑…` 全是 U+2011 不换行连字符,看着对却过不了 kebab 正则,
 * 又无提示。归一化让"看着像 kebab"就真能用,静默失败从源头消除。
 */
function normalizeSolutionCode(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‐-―−－]/g, "-")
    .replace(/\s+/g, "-");
}

function buildCreatePayload(form: CreateForm): ProductSolutionWriteInput {
  return {
    solutionCode: form.solutionCode.trim(),
    solutionName: form.solutionName.trim(),
    industry: form.industry.trim() || null,
    scenario: form.scenario.trim() || null,
    customerSegment: form.customerSegment.trim() || null,
    ownerTeam: form.ownerTeam.trim() || null,
    description: form.description.trim() || null,
  };
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
    ...solution.tags,
    ...solution.products.map(
      (product) =>
        `${product.productCode} ${product.productName} ${product.role}`,
    ),
    ...solution.tiers.map(
      (tier) => `${tier.tierCode} ${tier.tierName} ${tier.planCode}`,
    ),
  ]
    .join(" ")
    .toLowerCase();
}

/** Spread into `toast()` — `exactOptionalPropertyTypes` forbids an explicit undefined description. */
function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

function errorMessage(error: unknown): string | undefined {
  return describeError(error).description;
}

function CapabilityTags({
  products,
  maxVisible = 3,
}: {
  products: ProductSolutionCapability[];
  maxVisible?: number;
}) {
  const labels = useSolutionLabels();
  const visibleProducts = products.slice(0, maxVisible);
  const hiddenCount = Math.max(0, products.length - visibleProducts.length);

  return (
    <span className="flex min-w-0 flex-nowrap items-center gap-xs overflow-hidden">
      {visibleProducts.map((product) => (
        <Badge
          key={product.id}
          title={`${labels.capabilityType(product.productType)} | ${labels.source(product.source)}${product.role ? ` | ${product.role}` : ""}`}
        >
          {product.productName}
        </Badge>
      ))}
      {hiddenCount ? <Badge>+{formatNumber(hiddenCount)}</Badge> : null}
    </span>
  );
}

export function ProductSolutionsPage() {
  const t = useTranslations("productSolutionsPage");
  const tShared = useTranslations();
  const labels = useSolutionLabels();
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  /* 方案写操作走 step-up（与套餐版本发布同一风险级，70-product-solutions.md §7）。 */
  const { runWithStepUp } = useStepUp();
  const withLabels = useConfirmLabels();
  const [solutions, setSolutions] = useState<ProductSolutionRecord[]>([]);
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyCreateForm);
  const [submitting, setSubmitting] = useState(false);
  const [busyCode, setBusyCode] = useState<string | null>(null);

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
        setLoadError(errorMessage(error) ?? t("feedback.loadError"));
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
  const hasFilters =
    query.trim().length > 0 ||
    statusFilter !== "all" ||
    visibilityFilter !== "all" ||
    industryFilter !== "all" ||
    sourceFilter !== "all";

  useEffect(() => {
    setCurrentPage(1);
  }, [
    industryFilter,
    pageSize,
    query,
    sourceFilter,
    statusFilter,
    visibilityFilter,
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

  /* 编码非空但不合 kebab —— 用来把「创建」灰按钮变得可解释（此前无任何提示，
     用户填了中文/大写就点不动也不知为何，2026-08-31 owner 报「灰色点不动」）。 */
  const codeInvalid =
    form.solutionCode.trim().length > 0 &&
    !SOLUTION_CODE_RE.test(form.solutionCode.trim());

  function openCreate() {
    setForm(emptyCreateForm());
    setDialogOpen(true);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createFormIsValid(form)) return;
    setSubmitting(true);
    try {
      const created = await runWithStepUp(() =>
        createProductSolution(buildCreatePayload(form)),
      );
      toast({
        tone: "success",
        title: t("feedback.created", { name: created.solutionName }),
      });
      setDialogOpen(false);
      handleOpenDetails(created.solutionCode);
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      toast({
        tone: "danger",
        title: t("feedback.createFailed"),
        ...describeError(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  /** 状态迁移：BFF 是守卫，这里只是把结果替换进列表并说一声。 */
  async function transition(
    solution: ProductSolutionRecord,
    next: ProductSolutionStatus,
  ) {
    setBusyCode(solution.solutionCode);
    try {
      const updated = await runWithStepUp(() =>
        setProductSolutionState(solution.solutionCode, next),
      );
      setSolutions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast({
        tone: "success",
        title: t("feedback.stateChanged", {
          name: updated.solutionName,
          state: labels.status(updated.status),
        }),
      });
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      toast({
        tone: "danger",
        title: t("feedback.stateFailed"),
        ...describeError(error),
      });
      throw error;
    } finally {
      setBusyCode(null);
    }
  }

  /** 删除方案(软删)：有生效订阅时后端 409,提示改走退役。 */
  async function remove(solution: ProductSolutionRecord) {
    setBusyCode(solution.solutionCode);
    try {
      await runWithStepUp(() => deleteProductSolution(solution.solutionCode), {
        danger: true,
        submitLabel: t("confirm.deleteStepUp"),
      });
      setSolutions((current) =>
        current.filter((item) => item.id !== solution.id),
      );
      toast({
        tone: "success",
        title: t("feedback.deleted", { name: solution.solutionName }),
      });
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      toast({
        tone: "danger",
        title: t("feedback.deleteFailed"),
        ...describeError(error),
      });
    } finally {
      setBusyCode(null);
    }
  }

  function rowActions(solution: ProductSolutionRecord): ActionMenuItem[] {
    const busy = busyCode === solution.solutionCode;
    const items: ActionMenuItem[] = [
      {
        id: "details",
        label: tShared("actions.viewDetail"),
        icon: "arrow-right",
        onSelect: () => handleOpenDetails(solution.solutionCode),
      },
    ];
    for (const next of SOLUTION_STATE_TRANSITIONS[solution.status]) {
      if (next === "deprecated") {
        items.push({
          id: "deprecate",
          label: labels.transition("deprecated"),
          icon: "trash",
          danger: true,
          disabled: busy,
          separatorBefore: true,
          confirm: withLabels({
            verb: labels.transition("deprecated"),
            target: t("confirm.target", { name: solution.solutionName }),
            consequence: t("confirm.deprecateConsequence"),
            onConfirm: () => transition(solution, "deprecated"),
          }),
        });
      } else {
        items.push({
          id: `to-${next}`,
          label: labels.transition(next),
          icon: next === "active" ? "check" : "x",
          disabled: busy,
          onSelect: () => void transition(solution, next).catch(() => {}),
        });
      }
    }
    // 删除:与退役并列的出口(误建方案)。有生效订阅后端 409,提示改退役。
    items.push({
      id: "delete",
      label: t("actions.delete"),
      icon: "trash",
      danger: true,
      disabled: busy,
      separatorBefore: true,
      confirm: withLabels({
        verb: t("actions.delete"),
        target: t("confirm.target", { name: solution.solutionName }),
        consequence: t("confirm.deleteConsequence"),
        onConfirm: () => remove(solution),
      }),
    });
    return items;
  }

  const columns: DataTableColumn<ProductSolutionRecord>[] = [
    {
      id: "solution",
      header: t("columns.solution"),
      cell: (solution) => (
        <TableTitleCell
          icon="workflow"
          title={solution.solutionName}
          description={
            solution.ownerTeam
              ? `${solution.solutionCode} · ${solution.ownerTeam}`
              : solution.solutionCode
          }
          onTitleClick={() => handleOpenDetails(solution.solutionCode)}
        />
      ),
    },
    {
      id: "scenario",
      header: t("columns.scenario"),
      align: "center",
      cell: (solution) => (
        <TableTitleCell
          title={
            <span className="inline-flex flex-wrap justify-center gap-2xs">
              <StatusBadge tone={SOLUTION_STATUS_TONE[solution.status]}>
                {labels.status(solution.status)}
              </StatusBadge>
              <StatusBadge tone={VISIBILITY_TONE[solution.visibility]}>
                {labels.visibility(solution.visibility)}
              </StatusBadge>
            </span>
          }
          description={
            [solution.industry, solution.scenario]
              .filter(Boolean)
              .join(" | ") || t("columns.noScenario")
          }
        />
      ),
    },
    {
      id: "products",
      header: t("columns.products"),
      cell: (solution) =>
        solution.products.length ? (
          <TableTitleCell
            title={<CapabilityTags products={solution.products} />}
            description={t("columns.productsMeta", {
              count: solution.products.length,
              partner: solution.products.filter(
                (product) => product.source === "partner",
              ).length,
            })}
          />
        ) : (
          <span className="text-body-sm text-muted-foreground">
            {t("columns.noProducts")}
          </span>
        ),
    },
    {
      id: "tiers",
      header: t("columns.tiers"),
      align: "center",
      cell: (solution) =>
        solution.tiers.length ? (
          <TableTitleCell
            title={
              <span className="inline-flex flex-wrap justify-center gap-2xs">
                {solution.tiers.map((tier) => (
                  <Badge
                    key={tier.tierCode}
                    className={tierBadgeClass(tier.tierCode)}
                    title={`${tier.planCode} · ${tier.priceLabel}`}
                  >
                    {labels.tier(tier.tierCode)}
                  </Badge>
                ))}
              </span>
            }
            description={t("columns.tiersMeta", {
              count: solution.tiers.length,
              total: TIERS.length,
              updatedAt: formatDate(solution.updatedAt, locale),
            })}
          />
        ) : (
          <span className="text-body-sm text-muted-foreground">
            {t("columns.noTiers")}
          </span>
        ),
    },
    {
      id: "operation",
      header: t("columns.operation"),
      align: "right",
      cell: (solution) => (
        <TableTitleCell
          title={formatMoney(solution.monthlyRevenue)}
          description={t("columns.operationMeta", {
            subscriptions: solution.subscriptionCount,
            tenants: solution.activeTenantCount,
          })}
        />
      ),
    },
  ];

  const emptyState = loadError ? (
    <EmptyState
      icon="warning"
      title={t("empty.loadFailedTitle")}
      description={loadError}
    />
  ) : solutions.length === 0 ? (
    <EmptyState
      title={t("empty.noneTitle")}
      description={t("empty.noneDescription")}
      action={
        <ActionButton icon="plus" onClick={openCreate}>
          {t("actions.create")}
        </ActionButton>
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
    <>
      <ListPageTemplate
        className="w-full vx-product-solutions-page"
        header={
          <PageHeader
            icon="workflow"
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
                  id: "total",
                  help: t("summary.totalHelp"),
                  icon: "workflow",
                  label: t("summary.total"),
                  value: formatNumber(solutions.length),
                  tags: [t("summary.activeTag", { count: activeSolutions })],
                },
                {
                  id: "products",
                  help: t("summary.productsHelp"),
                  icon: "cube",
                  label: t("summary.products"),
                  value: formatNumber(productCount),
                  tags: [
                    t("summary.partnerTag", { count: partnerProductCount }),
                  ],
                  tone: "success",
                },
                {
                  id: "tiers",
                  help: t("summary.tiersHelp"),
                  icon: "star",
                  label: t("summary.tiers"),
                  value: formatNumber(tierCount),
                  tags: [
                    t("summary.subscriptionsTag", {
                      count: subscriptionCount,
                    }),
                  ],
                  tone: "warning",
                },
                {
                  id: "revenue",
                  help: t("summary.revenueHelp"),
                  icon: "chart-bar",
                  label: t("summary.revenue"),
                  value: formatMoney(monthlyRevenue),
                  tags: [
                    t("summary.industriesTag", { count: industries.length }),
                  ],
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
            count={formatNumber(filteredSolutions.length)}
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
              <ActionButton icon="plus" onClick={openCreate}>
                {t("actions.create")}
              </ActionButton>
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
                value={visibilityFilter}
                onChange={(event) =>
                  setVisibilityFilter(event.target.value as VisibilityFilter)
                }
                aria-label={t("filters.visibility")}
              >
                <option value="all">{t("filters.allVisibility")}</option>
                <option value="public">{labels.visibility("public")}</option>
                <option value="internal">
                  {labels.visibility("internal")}
                </option>
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
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(event.target.value as SourceFilter)
                }
                aria-label={t("filters.source")}
              >
                <option value="all">{t("filters.allSources")}</option>
                <option value="self">{labels.source("self")}</option>
                <option value="partner">{labels.source("partner")}</option>
              </NativeSelect>
            </>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label={t("table.ariaLabel")}
          >
            <DataTable
              columns={columns}
              rows={visibleSolutions}
              rowKey={(solution) => solution.id}
              loading={loading}
              indexStart={(activePage - 1) * pageSize + 1}
              selectedKeys={[...selectedSolutionIds]}
              onSelectionChange={(keys) =>
                setSelectedSolutionIds(new Set(keys))
              }
              rowActions={(solution) => (
                <div
                  className="relative z-[1] inline-flex justify-self-end"
                  onClick={(event) => event.stopPropagation()}
                >
                  <ActionMenu
                    label={t("actions.menuLabel", {
                      name: solution.solutionName,
                    })}
                    items={rowActions(solution)}
                  />
                </div>
              )}
              empty={emptyState}
            />
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

      {dialogOpen ? (
        <DialogForm
          open
          size="xl"
          title={t("dialog.title")}
          description={t("dialog.description")}
          submitLabel={t("dialog.submit")}
          cancelLabel={tShared("actions.cancel")}
          submitting={submitting}
          submitDisabled={!createFormIsValid(form)}
          onOpenChange={(open) => {
            if (!open) setDialogOpen(false);
          }}
          onSubmit={(event) => void submitCreate(event)}
        >
          {/* Single-line inputs (only description is multi-line) keep the dialog
              short enough to avoid a scrollbar; each field shows a live char
              count whose max matches the backend readSolutionFields limit
              (owner 2026-08-31). */}
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <SolutionField
              label={t("dialog.fields.solutionCode")}
              required
              hint={
                codeInvalid
                  ? t("dialog.fields.solutionCodeInvalid")
                  : t("dialog.fields.solutionCodeHint")
              }
              hintTone={codeInvalid ? "danger" : "muted"}
              count={{ value: form.solutionCode, max: 64 }}
            >
              <Input
                value={form.solutionCode}
                maxLength={64}
                placeholder={t("dialog.fields.solutionCodePlaceholder")}
                onChange={(event) =>
                  setForm((old) => ({
                    ...old,
                    solutionCode: normalizeSolutionCode(event.target.value),
                  }))
                }
                required
              />
            </SolutionField>
            <SolutionField
              label={t("dialog.fields.solutionName")}
              required
              count={{ value: form.solutionName, max: 128 }}
            >
              <Input
                value={form.solutionName}
                maxLength={128}
                onChange={(event) =>
                  setForm((old) => ({
                    ...old,
                    solutionName: event.target.value,
                  }))
                }
                required
              />
            </SolutionField>
          </div>
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <SolutionField
              label={t("dialog.fields.industry")}
              count={{ value: form.industry, max: 128 }}
            >
              <Input
                value={form.industry}
                maxLength={128}
                onChange={(event) =>
                  setForm((old) => ({ ...old, industry: event.target.value }))
                }
              />
            </SolutionField>
            <SolutionField
              label={t("dialog.fields.ownerTeam")}
              count={{ value: form.ownerTeam, max: 128 }}
            >
              <Input
                value={form.ownerTeam}
                maxLength={128}
                onChange={(event) =>
                  setForm((old) => ({ ...old, ownerTeam: event.target.value }))
                }
              />
            </SolutionField>
          </div>
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <SolutionField
              label={t("dialog.fields.scenario")}
              count={{ value: form.scenario, max: 128 }}
            >
              <Input
                value={form.scenario}
                maxLength={128}
                onChange={(event) =>
                  setForm((old) => ({ ...old, scenario: event.target.value }))
                }
              />
            </SolutionField>
            <SolutionField
              label={t("dialog.fields.customerSegment")}
              count={{ value: form.customerSegment, max: 255 }}
            >
              <Input
                value={form.customerSegment}
                maxLength={255}
                onChange={(event) =>
                  setForm((old) => ({
                    ...old,
                    customerSegment: event.target.value,
                  }))
                }
              />
            </SolutionField>
          </div>
          <SolutionField
            label={t("dialog.fields.description")}
            count={{ value: form.description, max: 4000 }}
          >
            <Textarea
              value={form.description}
              rows={4}
              maxLength={4000}
              onChange={(event) =>
                setForm((old) => ({ ...old, description: event.target.value }))
              }
            />
          </SolutionField>
        </DialogForm>
      ) : null}
    </>
  );
}
