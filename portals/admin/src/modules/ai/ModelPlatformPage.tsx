"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionButton,
  ActionMenu,
  Badge,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  Label,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  useToast,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import { activeTone } from "@/modules/shared/tenant-tone";
import { ListPagination } from "@/modules/shared/ListPagination";
import {
  activateModelPriceRule,
  createModelPriceRule,
  deactivateModelPriceRule,
  fetchAiModels,
  fetchModelPolicies,
  fetchModelPriceRules,
  fetchModelProviders,
  fetchTenantModelQuotas,
  fetchTenantModelUsageSummaries,
  updateModelPriceRule,
  type ModelPriceRuleWriteInput,
} from "@/api/admin-bff";
import type {
  AiModelRecord,
  ModelPolicyRecord,
  ModelPriceRuleRecord,
  ModelProviderRecord,
  TenantQuotaRecord,
  TenantUsageSummaryRecord,
} from "@/entities/console";
import { useConsoleTranslations } from "@/lib/ConsoleIntl";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";

type ViewMode = "list" | "cards";
type ModelStatusFilter = "all" | "active" | "inactive";
type ModelSourceFilter = "all" | "online" | "private";
type Feedback = {
  tone: "success" | "error";
  key: string;
  values?: Record<string, number | string>;
} | null;
type ModelLinkStatus = "normal" | "abnormal" | "checking";

// Per-token unit prices are legitimately sub-cent (NUMERIC(18,6)) — keep the
// significant fraction but drop the "0.001000"-style trailing-zero noise.
// (Forcing 2dp here would flatten 0.0012 to 0.00.)
function trimUnitPrice(raw: string): string {
  const n = Number(raw);
  return Number.isFinite(n) ? String(n) : raw;
}

type PriceRuleDialogState = {
  mode: "create" | "edit";
  id: string | null;
} | null;

interface PriceRuleForm {
  modelId: string;
  billingMode: string;
  currency: string;
  unitTokens: string;
  inputUnitPrice: string;
  outputUnitPrice: string;
  requestUnitPrice: string;
  effectiveAt: string;
  expiresAt: string;
}

function defaultPriceRuleForm(modelId: string): PriceRuleForm {
  return {
    modelId,
    billingMode: "token",
    currency: "CNY",
    unitTokens: "1000000",
    inputUnitPrice: "0",
    outputUnitPrice: "0",
    requestUnitPrice: "0",
    effectiveAt: "",
    expiresAt: "",
  };
}

function priceRuleFormFromRecord(rule: ModelPriceRuleRecord): PriceRuleForm {
  return {
    modelId: rule.modelId,
    billingMode: rule.billingMode,
    currency: rule.currency,
    unitTokens: String(rule.unitTokens),
    inputUnitPrice: rule.inputUnitPrice,
    outputUnitPrice: rule.outputUnitPrice,
    requestUnitPrice: rule.requestUnitPrice,
    effectiveAt: toDateTimeLocal(rule.effectiveAt),
    expiresAt: toDateTimeLocal(rule.expiresAt),
  };
}

// 把后端 ISO 时间转成 datetime-local 输入控件的本地墙钟值，保证编辑回填后再提交
// 能还原为同一时刻（避免直接截断 UTC 字符串造成的时区偏移累积）。
function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

function isPrivateProvider(provider: string) {
  return ["private", "custom", "self-hosted"].includes(provider);
}

function modelSearchText(model: AiModelRecord) {
  return [
    model.modelName,
    model.modelCode,
    model.provider,
    model.protocol,
    model.endpointUrl,
    model.keyReference?.name ?? "",
    ...model.capabilities,
  ]
    .join(" ")
    .toLowerCase();
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function modelTone(model: AiModelRecord) {
  if (!model.isActive) return "muted";
  return isPrivateProvider(model.provider) ? "private" : "active";
}

const LINK_STATUS_TONE: Record<ModelLinkStatus, StatusBadgeTone> = {
  normal: "success",
  abnormal: "danger",
  checking: "info",
};

const LINK_STATUS_LABEL: Record<ModelLinkStatus, string> = {
  normal: "正常",
  abnormal: "异常",
  checking: "检测中",
};

function detectModelLinkStatus(model: AiModelRecord): ModelLinkStatus {
  return model.endpointUrl.trim() &&
    model.protocol.trim() &&
    (model.keyReference === null || model.keyReference.configured)
    ? "normal"
    : "abnormal";
}

export function ModelPlatformPage() {
  const t = useConsoleTranslations("modelPlatformPage");
  const { toast } = useToast();
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [providers, setProviders] = useState<ModelProviderRecord[]>([]);
  const [priceRules, setPriceRules] = useState<ModelPriceRuleRecord[]>([]);
  const [policies, setPolicies] = useState<ModelPolicyRecord[]>([]);
  const [quotas, setQuotas] = useState<TenantQuotaRecord[]>([]);
  const [usageSummaries, setUsageSummaries] = useState<
    TenantUsageSummaryRecord[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [linkStatusByModelId, setLinkStatusByModelId] = useState<
    Record<string, ModelLinkStatus>
  >({});
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ModelStatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<ModelSourceFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  /**
   * 上游读取是否失败。**不复用 `feedback`**：那条横幅会被后续的保存、启停操作
   * 覆盖，而"这张表为什么是空的"必须一直可查。
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [priceRuleDialog, setPriceRuleDialog] =
    useState<PriceRuleDialogState>(null);
  const [priceRuleForm, setPriceRuleForm] = useState<PriceRuleForm>(() =>
    defaultPriceRuleForm(""),
  );

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      fetchAiModels(true),
      fetchModelProviders(true),
      fetchModelPriceRules({ includeInactive: true }),
      fetchModelPolicies({ includeInactive: true }),
      fetchTenantModelQuotas({ includeExpired: true }),
      fetchTenantModelUsageSummaries(),
    ])
      .then(
        ([
          records,
          providerRecords,
          priceRuleRecords,
          policyRecords,
          quotaRecords,
          usageRecords,
        ]) => {
          if (!active) return;
          setModels(records);
          setProviders(providerRecords);
          setPriceRules(priceRuleRecords);
          setPolicies(policyRecords);
          setQuotas(quotaRecords);
          setUsageSummaries(usageRecords);
          setLinkStatusByModelId(
            Object.fromEntries(
              records.map((model) => [model.id, detectModelLinkStatus(model)]),
            ),
          );
          setLoadFailed(false);
        },
      )
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          setFeedback({ tone: "error", key: "feedback.loadError" });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, sourceFilter, statusFilter, viewMode]);

  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return models.filter((model) => {
      const matchesQuery =
        !normalizedQuery || modelSearchText(model).includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && model.isActive) ||
        (statusFilter === "inactive" && !model.isActive);
      const matchesSource =
        sourceFilter === "all" ||
        (sourceFilter === "online" && !isPrivateProvider(model.provider)) ||
        (sourceFilter === "private" && isPrivateProvider(model.provider));

      return matchesQuery && matchesStatus && matchesSource;
    });
  }, [models, query, sourceFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * pageSize;
  const pagedModels = filteredModels.slice(pageStart, pageStart + pageSize);
  const activeModels = models.filter((model) => model.isActive).length;
  const inactiveModels = models.length - activeModels;
  const privateModels = models.filter((model) =>
    isPrivateProvider(model.provider),
  ).length;
  const onlineModels = models.length - privateModels;
  const activeProviders = providers.filter((provider) => provider.isActive);
  const activePolicies = policies.filter((policy) => policy.isActive);
  const activePriceRules = priceRules.filter((rule) => rule.isActive);
  const activeQuotas = quotas.filter((quota) => quota.isActive);
  const totalUsageTokens = usageSummaries.reduce(
    (total, summary) => total + Number(summary.totalTokens || 0),
    0,
  );

  const statusFilters = [
    { value: "all", label: t("filters.all") },
    { value: "active", label: t("filters.active") },
    { value: "inactive", label: t("filters.inactive") },
  ] as const;
  const sourceFilters = [
    { value: "all", label: t("filters.all") },
    { value: "online", label: t("filters.online") },
    { value: "private", label: t("filters.private") },
  ] as const;

  function providerLabel(provider: string) {
    const label = t(`providers.${provider}`);
    return label.startsWith("modelPlatformPage.providers.") ? provider : label;
  }

  /* 列定义每次渲染重建：单元格取值依赖 t / 对话框开关等本次渲染的闭包，
     memo 起来反而要把它们全列进依赖数组。 */
  const modelColumns: DataTableColumn<AiModelRecord>[] = [
    {
      id: "model",
      header: t("table.columns.model"),
      cell: (model) => (
        <TableTitleCell
          icon={isPrivateProvider(model.provider) ? "code" : "plug"}
          title={model.modelName}
          description={model.modelCode}
        />
      ),
    },
    {
      id: "status",
      header: t("table.columns.status"),
      align: "center",
      cell: (model) => (
        <StatusBadge
          tone={model.isActive ? "success" : "neutral"}
          icon={model.isActive ? "check" : "x"}
        >
          {model.isActive ? t("status.active") : t("status.inactive")}
        </StatusBadge>
      ),
    },
    {
      id: "link",
      header: "链路状态",
      align: "center",
      cell: (model) => {
        const link =
          linkStatusByModelId[model.id] ?? detectModelLinkStatus(model);
        return (
          <StatusBadge tone={LINK_STATUS_TONE[link]}>
            {LINK_STATUS_LABEL[link]}
          </StatusBadge>
        );
      },
    },
    {
      id: "source",
      header: "来源",
      cell: (model) => (
        <TableTitleCell
          title={providerLabel(model.provider)}
          description={model.protocol}
        />
      ),
    },
    {
      id: "capabilities",
      header: "模型能力",
      cell: (model) => (
        <span className="flex flex-wrap gap-2xs">
          {model.capabilities.slice(0, 3).map((capability) => (
            <Badge key={capability}>{capability}</Badge>
          ))}
          {model.capabilities.length > 3 ? (
            <Badge>+{model.capabilities.length - 3}</Badge>
          ) : null}
        </span>
      ),
    },
  ];

  function handleReset() {
    setQuery("");
    setStatusFilter("all");
    setSourceFilter("all");
  }

  // Provider / Model 的创建、编辑、启停、删除已迁移至 opera（技术运维平台，
  // 2026-08-11）：opera-bff 自己的 atlas.router.ts 才是这两类资源的写入口，
  // admin-bff 这一侧对应端点已撤走。本页往下只读它们（给价格规则/策略挑
  // model 用），不再提供任何写入 UI——两段裁决里 provider/model 生命周期
  // 属技术供给，归 opera；本页留的是商业封装（价格规则/策略/配额/用量）。

  // ── Price rule 写路径 ──────────────────────────────────────────────────────

  async function reloadPriceRules() {
    setPriceRules(await fetchModelPriceRules({ includeInactive: true }));
  }

  function openCreatePriceRuleDialog() {
    setPriceRuleForm(defaultPriceRuleForm(models[0]?.id ?? ""));
    setPriceRuleDialog({ mode: "create", id: null });
  }

  function openEditPriceRuleDialog(rule: ModelPriceRuleRecord) {
    setPriceRuleForm(priceRuleFormFromRecord(rule));
    setPriceRuleDialog({ mode: "edit", id: rule.id });
  }

  async function submitPriceRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!priceRuleDialog) return;

    const common: Partial<Omit<ModelPriceRuleWriteInput, "modelId">> = {
      billingMode: priceRuleForm.billingMode.trim() || "token",
      currency: priceRuleForm.currency.trim() || "CNY",
      inputUnitPrice: priceRuleForm.inputUnitPrice.trim() || "0",
      outputUnitPrice: priceRuleForm.outputUnitPrice.trim() || "0",
      requestUnitPrice: priceRuleForm.requestUnitPrice.trim() || "0",
      expiresAt: priceRuleForm.expiresAt || null,
    };
    const parsedUnitTokens = Number(priceRuleForm.unitTokens);
    if (Number.isFinite(parsedUnitTokens) && parsedUnitTokens > 0) {
      common.unitTokens = parsedUnitTokens;
    }
    if (priceRuleForm.effectiveAt) {
      common.effectiveAt = priceRuleForm.effectiveAt;
    }

    setCatalogBusy(true);
    try {
      if (priceRuleDialog.mode === "create") {
        if (!priceRuleForm.modelId) {
          toast({ tone: "danger", title: "请先选择模型" });
          return;
        }
        await createModelPriceRule({
          modelId: priceRuleForm.modelId,
          ...common,
        });
        toast({ tone: "success", title: "计价规则已创建" });
      } else if (priceRuleDialog.id) {
        await updateModelPriceRule(priceRuleDialog.id, common);
        toast({ tone: "success", title: "计价规则已更新" });
      }
      await reloadPriceRules();
      setPriceRuleDialog(null);
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setCatalogBusy(false);
    }
  }

  async function togglePriceRule(
    rule: ModelPriceRuleRecord,
    activate: boolean,
  ) {
    setCatalogBusy(true);
    try {
      await (activate
        ? activateModelPriceRule(rule.id)
        : deactivateModelPriceRule(rule.id));
      await reloadPriceRules();
      toast({
        tone: "success",
        title: activate ? "规则已启用" : "规则已停用",
      });
    } catch (error) {
      toast({ tone: "danger", title: "操作失败", ...describeError(error) });
    } finally {
      setCatalogBusy(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="vx-tenant-management-page vx-model-platform-page"
        header={
          <PageHeader
            icon="code"
            eyebrow={t("header.eyebrow")}
            title={t("header.title")}
            description={t("header.description")}
            secondary={<Badge>{t("header.badge")}</Badge>}
          />
        }
        summary={
          <>
            {" "}
            {feedback ? (
              <p
                className={
                  feedback.tone === "success"
                    ? "vx-profile-message"
                    : "vx-profile-error"
                }
              >
                {t(feedback.key, feedback.values)}
              </p>
            ) : null}
            <MetricGrid
              loading={loading}
              aria-label={t("summary.ariaLabel")}
              columns={3}
              items={[
                {
                  id: "models",
                  help: t("summary.modelsHelp"),
                  icon: "plug",
                  label: t("summary.models"),
                  value: formatNumber(models.length),
                  tags: [
                    `${t("filters.online")} ${formatNumber(onlineModels)}`,
                    `${t("filters.private")} ${formatNumber(privateModels)}`,
                  ],
                },
                {
                  id: "active",
                  help: t("summary.activeHelp"),
                  icon: "play",
                  label: t("filters.active"),
                  value: formatNumber(activeModels),
                  tags: ["可调度"],
                  tone: activeModels ? "success" : "warning",
                },
                {
                  id: "inactive",
                  help: t("summary.inactiveHelp"),
                  icon: "code",
                  label: t("status.inactive"),
                  value: formatNumber(inactiveModels),
                  tags: inactiveModels ? ["需复核"] : ["无停用"],
                  tone: inactiveModels ? "warning" : "success",
                },
                {
                  id: "providers",
                  help: "已接入的模型供应商数量。",
                  icon: "settings",
                  label: "Provider",
                  value: formatNumber(providers.length),
                  tags: [`启用 ${formatNumber(activeProviders.length)}`],
                  tone: activeProviders.length ? "success" : "warning",
                },
                {
                  id: "policies-cost",
                  help: "启用中的模型策略数 / 启用中的价格规则数。",
                  icon: "database",
                  label: "策略 / 成本",
                  value: `${formatNumber(activePolicies.length)} / ${formatNumber(activePriceRules.length)}`,
                  tags: [
                    `策略 ${formatNumber(policies.length)}`,
                    `价格 ${formatNumber(priceRules.length)}`,
                  ],
                  tone: "brand",
                },
                {
                  id: "quota-usage",
                  help: "启用中的配额条数 / 统计期内累计消耗 token。",
                  icon: "chart-bar",
                  label: "配额 / 用量",
                  value: `${formatNumber(activeQuotas.length)} / ${formatNumber(totalUsageTokens)}`,
                  tags: [
                    `配额 ${formatNumber(quotas.length)}`,
                    `汇总 ${formatNumber(usageSummaries.length)}`,
                  ],
                  tone: usageSummaries.length ? "success" : "warning",
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
            count={formatNumber(filteredModels.length)}
            aria-label="模型状态"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("table.searchPlaceholder")}
                className="vx-tenant-search"
                aria-label={t("table.searchAriaLabel")}
              />
            }
            onReset={handleReset}
          >
            <div className="vx-tenant-filters">
              <NativeSelect
                className="vx-tenant-select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as ModelStatusFilter)
                }
                aria-label="模型状态"
              >
                {statusFilters.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect
                className="vx-tenant-select"
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(event.target.value as ModelSourceFilter)
                }
                aria-label="模型来源"
              >
                {sourceFilters.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </FilterBar>
        }
        table={
          <section
            className="vx-tenant-directory"
            aria-label={t("table.toolbarTitle", {
              count: filteredModels.length,
            })}
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="vx-tenant-directory__header">
                <span>{t("empty.loadingTitle")}</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
                columns={modelColumns}
                rows={pagedModels}
                rowKey={(model) => model.id}
                loading={loading}
                indexStart={pageStart + 1}
                empty={
                  loadFailed ? (
                    /* 读取失败与"筛选没匹配上"是两回事。混成一种，本页就会在顶部
                     横幅已经报出「模型数据读取失败」的同时，两行之下劝人去放宽
                     筛选——同一屏自相矛盾（2026-08-07 走查）。 */
                    <EmptyState
                      icon="warning"
                      title={t("empty.loadFailedTitle")}
                      description={t("empty.loadFailedDescription")}
                    />
                  ) : (
                    <EmptyState
                      title={t("empty.title")}
                      description={t("empty.description")}
                      action={
                        <ActionButton
                          variant="outline"
                          icon="x"
                          onClick={handleReset}
                        >
                          {t("empty.resetFilters")}
                        </ActionButton>
                      }
                    />
                  )
                }
              />
            ) : pagedModels.length ? (
              <div
                className="vx-tenant-directory-cards vx-model-platform-cards"
                aria-label={t("table.toolbarTitle", {
                  count: filteredModels.length,
                })}
              >
                {pagedModels.map((model) => (
                  <article
                    key={model.id}
                    className={`vx-tenant-directory-card vx-model-platform-card vx-model-platform-card--${modelTone(model)}`}
                  >
                    <header>
                      <Icon
                        name={
                          isPrivateProvider(model.provider) ? "code" : "plug"
                        }
                        size={24}
                        fallback="placeholder"
                      />
                      <div>
                        <TableTitleCell
                          title={model.modelName}
                          description={model.modelCode}
                        />
                      </div>
                    </header>
                    <div className="vx-tenant-directory-card__badges">
                      {/* 厂商是类目（在线 / 私有部署），没有严重度——不给语气色。
                          原先的蓝/绿两档背景实测从未生效：那族 CSS 排在
                          `.vx-tenant-pill` 基类之前，同层同特异度被基类压死。 */}
                      <Badge variant="outline">
                        {providerLabel(model.provider)}
                      </Badge>
                      <StatusBadge tone={activeTone(model.isActive)}>
                        {model.isActive
                          ? t("status.active")
                          : t("status.inactive")}
                      </StatusBadge>
                    </div>
                    <div className="vx-tenant-directory-card__metrics">
                      <span>
                        <b>{model.capabilities.length}</b>
                        <small>{t("table.columns.capabilities")}</small>
                      </span>
                      <span>
                        <b>
                          {isPrivateProvider(model.provider)
                            ? t("filters.private")
                            : t("filters.online")}
                        </b>
                        <small>{t("table.columns.provider")}</small>
                      </span>
                      <span>
                        <b>{model.protocol}</b>
                        <small>{t("dialogs.fields.protocol")}</small>
                      </span>
                    </div>
                    <footer>
                      <span>
                        {model.capabilities.slice(0, 2).join(", ") || "-"}
                      </span>
                      <strong>{model.keyReference?.name || "-"}</strong>
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <section className="vx-tenant-empty">
                <EmptyState
                  title={loading ? t("empty.loadingTitle") : t("empty.title")}
                  description={
                    loading
                      ? t("empty.loadingDescription")
                      : t("empty.description")
                  }
                  action={
                    <ActionButton
                      variant="outline"
                      icon="x"
                      onClick={handleReset}
                    >
                      {t("empty.resetFilters")}
                    </ActionButton>
                  }
                />
              </section>
            )}
          </section>
        }
        footer={
          <ListPagination
            currentPage={safeCurrentPage}
            pageCount={totalPages}
            // 这一页的计数语走 i18n（本页整体已接 useConsoleTranslations），
            // 不是 DS 那句固定中文。
            countLabel={t("pagination.summary", {
              page: safeCurrentPage,
              totalPages,
              total: filteredModels.length,
            })}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={setCurrentPage}
          />
        }
      />

      <div className="vx-tenant-list-shell">
        <section className="vx-tenant-toolbar" aria-label="模型厂商管理">
          <strong>模型厂商</strong>
          <span className="vx-tenant-view-count">
            {formatNumber(providers.length)}
          </span>
          <span className="vx-tenant-toolbar__spacer" aria-hidden="true" />
          {/* 只读：厂商的创建/编辑/启停/删除已迁至 opera 技术运维平台。 */}
        </section>
        <section className="vx-tenant-directory" aria-label="模型厂商列表">
          {providers.length ? (
            <div className="vx-tenant-directory-cards vx-model-platform-cards">
              {providers.map((provider) => (
                <article
                  key={provider.id}
                  className={`vx-tenant-directory-card vx-model-platform-card vx-model-platform-card--${provider.isActive ? "active" : "muted"}`}
                >
                  <header>
                    <Icon name="settings" size={24} fallback="placeholder" />
                    <div>
                      <TableTitleCell
                        title={provider.providerName}
                        description={provider.providerCode}
                      />
                    </div>
                  </header>
                  <div className="vx-tenant-directory-card__badges">
                    <Badge>{provider.providerType}</Badge>
                    <StatusBadge tone={activeTone(provider.isActive)}>
                      {provider.isActive
                        ? t("status.active")
                        : t("status.inactive")}
                    </StatusBadge>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <section className="vx-tenant-empty">
              <EmptyState
                title="暂无厂商"
                description="供应商的接入与管理已迁至 opera 技术运维平台。"
              />
            </section>
          )}
        </section>
      </div>

      <div className="vx-tenant-list-shell">
        <section className="vx-tenant-toolbar" aria-label="计价规则管理">
          <strong>计价规则</strong>
          <span className="vx-tenant-view-count">
            {formatNumber(priceRules.length)}
          </span>
          <span className="vx-tenant-toolbar__spacer" aria-hidden="true" />
          <ActionButton
            icon="plus"
            disabled={models.length === 0}
            onClick={openCreatePriceRuleDialog}
          >
            新建规则
          </ActionButton>
        </section>
        <section className="vx-tenant-directory" aria-label="计价规则列表">
          {priceRules.length ? (
            <div className="vx-tenant-directory-cards vx-model-platform-cards">
              {priceRules.map((rule) => {
                const ruleModel = modelById.get(rule.modelId);
                return (
                  <article
                    key={rule.id}
                    className={`vx-tenant-directory-card vx-model-platform-card vx-model-platform-card--${rule.isActive ? "active" : "muted"}`}
                  >
                    <header>
                      <Icon name="database" size={24} fallback="placeholder" />
                      <div>
                        <TableTitleCell
                          title={ruleModel?.modelName ?? rule.modelId}
                          description={`${rule.billingMode} · ${rule.currency}`}
                          onTitleClick={() => openEditPriceRuleDialog(rule)}
                        />
                      </div>
                      <ActionMenu
                        label={`${ruleModel?.modelName ?? rule.modelId} 计价规则操作`}
                        items={[
                          {
                            id: "edit",
                            label: "编辑",
                            icon: "edit",
                            onSelect: () => openEditPriceRuleDialog(rule),
                          },
                          {
                            id: "enable",
                            label: "启用",
                            icon: "play",
                            disabled: catalogBusy || rule.isActive,
                            onSelect: () => void togglePriceRule(rule, true),
                          },
                          {
                            id: "disable",
                            label: "停用",
                            icon: "stop",
                            disabled: catalogBusy || !rule.isActive,
                            onSelect: () => void togglePriceRule(rule, false),
                          },
                        ]}
                      />
                    </header>
                    <div className="vx-tenant-directory-card__badges">
                      <Badge>{rule.currency}</Badge>
                      <StatusBadge tone={activeTone(rule.isActive)}>
                        {rule.isActive
                          ? t("status.active")
                          : t("status.inactive")}
                      </StatusBadge>
                    </div>
                    <div className="vx-tenant-directory-card__metrics">
                      <span>
                        <b>{trimUnitPrice(rule.inputUnitPrice)}</b>
                        <small>输入单价</small>
                      </span>
                      <span>
                        <b>{trimUnitPrice(rule.outputUnitPrice)}</b>
                        <small>输出单价</small>
                      </span>
                      <span>
                        <b>{formatNumber(rule.unitTokens)}</b>
                        <small>计价单位</small>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <section className="vx-tenant-empty">
              <EmptyState
                title="暂无计价规则"
                description="点击「新建规则」为模型配置计价。"
              />
            </section>
          )}
        </section>
      </div>

      {priceRuleDialog ? (
        <DialogForm
          open
          title={
            priceRuleDialog.mode === "create" ? "新建计价规则" : "编辑计价规则"
          }
          submitLabel={t("dialogs.actions.save")}
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={catalogBusy}
          onOpenChange={(open) => {
            if (!open) setPriceRuleDialog(null);
          }}
          onSubmit={(event) => void submitPriceRule(event)}
        >
          <div className="vx-model-dialog__grid">
            <Label>
              模型
              <NativeSelect
                value={priceRuleForm.modelId}
                disabled={priceRuleDialog.mode === "edit"}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    modelId: event.target.value,
                  }))
                }
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelName}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              计费模式
              <Input
                value={priceRuleForm.billingMode}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    billingMode: event.target.value,
                  }))
                }
                placeholder="token"
              />
            </Label>
            <Label>
              币种
              <Input
                value={priceRuleForm.currency}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    currency: event.target.value,
                  }))
                }
                placeholder="CNY"
              />
            </Label>
            <Label>
              计价单位（tokens）
              <Input
                type="number"
                min={1}
                value={priceRuleForm.unitTokens}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    unitTokens: event.target.value,
                  }))
                }
              />
            </Label>
          </div>
          <div className="vx-model-dialog__grid">
            <Label>
              输入单价
              <Input
                value={priceRuleForm.inputUnitPrice}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    inputUnitPrice: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </Label>
            <Label>
              输出单价
              <Input
                value={priceRuleForm.outputUnitPrice}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    outputUnitPrice: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </Label>
            <Label>
              请求单价
              <Input
                value={priceRuleForm.requestUnitPrice}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    requestUnitPrice: event.target.value,
                  }))
                }
                placeholder="0"
              />
            </Label>
          </div>
          <div className="vx-model-dialog__grid">
            <Label>
              生效时间
              <Input
                type="datetime-local"
                value={priceRuleForm.effectiveAt}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    effectiveAt: event.target.value,
                  }))
                }
              />
            </Label>
            <Label>
              失效时间（可选）
              <Input
                type="datetime-local"
                value={priceRuleForm.expiresAt}
                onChange={(event) =>
                  setPriceRuleForm((old) => ({
                    ...old,
                    expiresAt: event.target.value,
                  }))
                }
              />
            </Label>
          </div>
        </DialogForm>
      ) : null}
    </>
  );
}
