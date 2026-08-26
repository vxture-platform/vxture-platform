"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ActionButton,
  ActionMenu,
  Badge,
  Banner,
  Button,
  Checkbox,
  DataTable,
  DialogForm,
  EmptyState,
  Icon,
  Input,
  Label,
  MetricGrid,
  NativeSelect,
  Pagination,
  StatusBadge,
  TableTitleCell,
  ViewLayout,
  ViewModeSwitch,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import { isEnabled } from "@vxture-platform/shared";
import {
  createAiModelGrant,
  fetchAiModelGrants,
  fetchAiModels,
  fetchProductAgents,
  fetchProductModelPolicies,
  setAiModelGrantActive,
  updateAiModelGrant,
} from "@/api/admin-bff";
import type {
  AiModelGrantRecord,
  AiModelRecord,
  ProductAgentRecord,
  ProductModelPolicyRecord,
} from "@/entities/console";
import { useTranslations } from "next-intl";
import { PageHeader } from "@/modules/shared/PageHeader";

type ViewMode = "list" | "cards";
type PolicyFilter =
  | "all"
  | "platform"
  | "product"
  | "defaults"
  | "undefined"
  | "usable";
type DialogMode = "createGrant" | "editGrant" | null;
type PolicyStatus = "usable" | "zeroQuota" | "inactive" | "undefined";
type Feedback = {
  tone: "success" | "error";
  key: string;
  values?: Record<string, number | string>;
} | null;

const POLICY_PAGE_SIZE = 12;
const OVERRIDE_PREVIEW_SIZE = 8;

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function defaultGrantForm(modelId = "") {
  return {
    modelId,
    tenantId: "",
    agentId: "",
    taskProfile: "",
    priority: "100",
    reason: "",
    expiresAt: "",
    isActive: true,
  };
}

function policyStatus(policy: ProductModelPolicyRecord): PolicyStatus {
  if (!policy.isDefined) {
    return "undefined";
  }

  if (!policy.isActive) {
    return "inactive";
  }

  if (!policy.isUnlimited && policy.quotaTokens <= 0) {
    return "zeroQuota";
  }

  return "usable";
}

/** 策略四态 -> DS 语气。零配额与未定义都是"配了但用不了"，同一档。 */
const POLICY_STATUS_TONE: Record<PolicyStatus, StatusBadgeTone> = {
  usable: "success",
  zeroQuota: "warning",
  undefined: "warning",
  inactive: "neutral",
};

function policySearchText(
  policy: ProductModelPolicyRecord,
  model: AiModelRecord | undefined,
) {
  return [
    policy.scopeCode,
    policy.scopeName,
    policy.subjectType,
    policy.subjectId,
    policy.subjectName,
    policy.productCode,
    policy.productName,
    policy.productRegion,
    policy.agentCode,
    policy.agentName,
    policy.modelCode,
    policy.note,
    model?.modelName,
    model?.provider,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isDefaultPolicy(policy: ProductModelPolicyRecord) {
  return (
    policy.scopeType === "new_product_default" ||
    policy.scopeType === "tenant_default"
  );
}

function policySubjectLabel(policy: ProductModelPolicyRecord) {
  return policy.subjectType === "platform" ? "平台主体" : "租户主体";
}

function grantSearchText(
  grant: AiModelGrantRecord,
  model: AiModelRecord | undefined,
  agent: ProductAgentRecord | undefined,
) {
  return [
    grant.tenantId,
    grant.agentId,
    grant.reason,
    agent?.agentCode,
    agent?.agentName,
    model?.modelCode,
    model?.modelName,
    model?.provider,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function toDateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function formatTokens(
  value: number,
  unlimited: boolean,
  unlimitedLabel: string,
) {
  if (unlimited) {
    return unlimitedLabel;
  }

  return new Intl.NumberFormat("zh-CN").format(value);
}

export function ModelGrantsPage() {
  const t = useTranslations("modelGrantsPage");
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [agents, setAgents] = useState<ProductAgentRecord[]>([]);
  const [policies, setPolicies] = useState<ProductModelPolicyRecord[]>([]);
  const [grants, setGrants] = useState<AiModelGrantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  /**
   * 读取是否失败。**不能复用 `feedback`**：它会被后续的保存/启停操作覆盖，
   * 而"这张表为什么是空的"这个事实必须一直可查。
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PolicyFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPolicyIds, setSelectedPolicyIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedGrantIds, setSelectedGrantIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedGrantId, setSelectedGrantId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [grantForm, setGrantForm] = useState(defaultGrantForm);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      fetchAiModels(true),
      fetchAiModelGrants(),
      fetchProductAgents(),
      fetchProductModelPolicies(),
    ])
      .then(([modelRecords, grantRecords, agentRecords, policyRecords]) => {
        if (!active) return;
        setModels(modelRecords);
        setGrants(grantRecords);
        setAgents(agentRecords);
        setPolicies(policyRecords);
        setSelectedGrantId(null);
        setSelectedPolicyIds(new Set());
        setSelectedGrantIds(new Set());
        setLoadFailed(false);
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          setFeedback({ tone: "error", key: "feedback.loadError" });
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, filter, viewMode]);

  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models],
  );

  const modelByCode = useMemo(
    () => new Map(models.map((model) => [model.modelCode, model])),
    [models],
  );

  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const grantById = useMemo(
    () => new Map(grants.map((grant) => [grant.id, grant])),
    [grants],
  );

  const filteredPolicies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return policies.filter((policy) => {
      const status = policyStatus(policy);
      const model = policy.modelCode
        ? modelByCode.get(policy.modelCode)
        : undefined;
      const matchesQuery =
        !normalizedQuery ||
        policySearchText(policy, model).includes(normalizedQuery);
      const matchesFilter =
        filter === "all" ||
        (filter === "product" && policy.scopeType === "product") ||
        (filter === "platform" && policy.subjectType === "platform") ||
        (filter === "defaults" && isDefaultPolicy(policy)) ||
        (filter === "undefined" && status === "undefined") ||
        (filter === "usable" && status === "usable");

      return matchesQuery && matchesFilter;
    });
  }, [filter, modelByCode, policies, query]);

  const filteredOverrides = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return grants.filter((grant) => {
      const model = modelById.get(grant.modelId);
      const agent = grant.agentId ? agentById.get(grant.agentId) : undefined;
      return (
        !normalizedQuery ||
        grantSearchText(grant, model, agent).includes(normalizedQuery)
      );
    });
  }, [agentById, grants, modelById, query]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredPolicies.length / POLICY_PAGE_SIZE),
  );
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStart = (safeCurrentPage - 1) * POLICY_PAGE_SIZE;
  const pagedPolicies = filteredPolicies.slice(
    pageStart,
    pageStart + POLICY_PAGE_SIZE,
  );
  const visibleOverrideGrants = filteredOverrides.slice(
    0,
    OVERRIDE_PREVIEW_SIZE,
  );
  const selectedGrant = selectedGrantId
    ? (grantById.get(selectedGrantId) ?? null)
    : null;
  const usablePolicies = policies.filter(
    (policy) => policyStatus(policy) === "usable",
  ).length;
  const platformPolicyCount = policies.filter(
    (policy) => policy.subjectType === "platform",
  ).length;
  const undefinedPolicies = policies.filter(
    (policy) => policyStatus(policy) === "undefined",
  ).length;

  const filters = [
    { value: "all", label: t("filters.all") },
    { value: "platform", label: "平台主体" },
    { value: "product", label: t("filters.product") },
    { value: "defaults", label: t("filters.defaults") },
    { value: "undefined", label: t("filters.undefined") },
    { value: "usable", label: t("filters.usable") },
  ] as const;

  /* 列定义每次渲染重建：单元格取值依赖 t / 对话框开关等本次渲染的闭包，
     memo 起来反而要把它们全列进依赖数组。 */
  const policyColumns: DataTableColumn<ProductModelPolicyRecord>[] = [
    {
      id: "scope",
      header: t("policyTable.columns.scope"),
      cell: (policy) => (
        <TableTitleCell
          icon="shield-check"
          title={policy.scopeName}
          description={`${policySubjectLabel(policy)} · ${policy.subjectId} · ${
            policy.scopeType === "product"
              ? `${policy.productCode} · ${policy.productRegion ? t(`policyTable.region.${policy.productRegion}`) : t("policyTable.region.none")}`
              : policy.scopeCode
          }`}
          {...(policy.note ? { tooltip: policy.note } : {})}
        />
      ),
    },
    {
      id: "status",
      header: t("policyTable.columns.status"),
      align: "center",
      cell: (policy) => {
        const status = policyStatus(policy);
        return (
          <StatusBadge tone={POLICY_STATUS_TONE[status]}>
            {t(`status.${status}`)}
          </StatusBadge>
        );
      },
    },
    {
      id: "model",
      header: t("policyTable.columns.model"),
      cell: (policy) => (
        <TableTitleCell
          title={
            policy.modelCode
              ? (modelByCode.get(policy.modelCode)?.modelName ??
                policy.modelCode)
              : t("policyTable.undefinedModel")
          }
          description={policy.modelCode ?? t("policyTable.defaultDeny")}
        />
      ),
    },
    {
      id: "agent",
      header: t("policyTable.columns.agent"),
      cell: (policy) => (
        <TableTitleCell
          title={policy.agentName}
          description={policy.agentCode ?? t("table.allAgents")}
        />
      ),
    },
    {
      id: "quota",
      header: t("policyTable.columns.quota"),
      align: "right",
      cell: (policy) =>
        formatTokens(
          policy.quotaTokens,
          policy.isUnlimited,
          t("policyTable.unlimited"),
        ),
    },
    {
      id: "priority",
      header: t("policyTable.columns.priority"),
      align: "right",
      cell: (policy) => policy.priority,
    },
  ];

  const overrideColumns: DataTableColumn<AiModelGrantRecord>[] = [
    {
      id: "model",
      header: t("table.columns.model"),
      cell: (grant) => {
        const model = modelById.get(grant.modelId);
        return (
          <TableTitleCell
            icon={isEnabled(grant.state) ? "play" : "stop"}
            title={model?.modelName ?? grant.modelId}
            description={model?.modelCode ?? grant.modelId}
            onTitleClick={() => openEditGrantDialog(grant)}
          />
        );
      },
    },
    {
      id: "status",
      header: t("table.columns.status"),
      align: "center",
      cell: (grant) => (
        <StatusBadge tone={isEnabled(grant.state) ? "success" : "neutral"}>
          {isEnabled(grant.state) ? t("status.active") : t("status.inactive")}
        </StatusBadge>
      ),
    },
    {
      id: "tenant",
      header: t("table.columns.tenant"),
      cell: (grant) => grant.tenantId,
    },
    {
      id: "agent",
      header: t("table.columns.agent"),
      cell: (grant) => agentLabel(grant.agentId),
    },
    {
      id: "priority",
      header: t("table.columns.priority"),
      align: "right",
      cell: (grant) => grant.priority,
    },
    {
      id: "expires",
      header: t("table.columns.expires"),
      cell: (grant) =>
        grant.expiresAt ? grant.expiresAt.slice(0, 10) : t("table.permanent"),
    },
  ];

  function resetFeedback() {
    setFeedback(null);
  }

  function agentLabel(agentId: string | null) {
    if (!agentId) {
      return t("table.allAgents");
    }

    const agent = agentById.get(agentId);
    return agent ? `${agent.agentName} · ${agent.agentCode}` : agentId;
  }

  async function reload(nextGrantId?: string | null) {
    const records = await fetchAiModelGrants();
    setGrants(records);
    setSelectedGrantId(nextGrantId ?? null);
    setSelectedGrantIds((current) => {
      const availableIds = new Set(records.map((grant) => grant.id));
      return new Set([...current].filter((id) => availableIds.has(id)));
    });
  }

  function openCreateGrantDialog() {
    setGrantForm(defaultGrantForm(models[0]?.id ?? ""));
    resetFeedback();
    setDialogMode("createGrant");
  }

  function openEditGrantDialog(grant: AiModelGrantRecord) {
    setSelectedGrantId(grant.id);
    setGrantForm({
      modelId: grant.modelId,
      tenantId: grant.tenantId,
      agentId: grant.agentId ?? "",
      taskProfile: grant.taskProfile ?? "",
      priority: String(grant.priority),
      reason: grant.reason ?? "",
      expiresAt: toDateInputValue(grant.expiresAt),
      isActive: isEnabled(grant.state),
    });
    resetFeedback();
    setDialogMode("editGrant");
  }

  async function submitGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    resetFeedback();

    try {
      /**
       * **`agentId` 只在创建时送。**
       *
       * atlas 的 `normalizeUpdateGrant` 对 `agentId` / `applicationId` /
       * `applicationType` 三个字段是**出现即拒**（400，不比对值）——租户授权的应用范围
       * 创建后固定，库里 `atlas_svc` 在这三列上根本没有 UPDATE 权限。
       *
       * 2026-08-23 实测：编辑一条授权、什么都不改直接保存 → 400。禁用一个输入框不等于
       * 把它从载荷里去掉，这与 opera 那边 Provider / 模型编辑踩的是同一个坑。
       */
      const payload = {
        /* `taskProfile` 在 create 与 update 上都收，所以它在共用的那一份里
           ——与 agentId 不同，改任务画像不需要停用重建。 */
        taskProfile: grantForm.taskProfile.trim() || null,
        priority: Number.parseInt(grantForm.priority, 10) || 100,
        reason: grantForm.reason.trim() || null,
        expiresAt: grantForm.expiresAt || null,
      };

      if (dialogMode === "createGrant") {
        const created = await createAiModelGrant({
          ...payload,
          agentId: grantForm.agentId.trim() || null,
          /* 只有 create 能设初始状态；改状态走行操作里的启停（见 api 层注释）。 */
          state: grantForm.isActive ? "active" : "inactive",
          modelId: grantForm.modelId,
          tenantId: grantForm.tenantId,
        });
        await reload(created.id);
        setFeedback({ tone: "success", key: "feedback.grantCreated" });
      } else if (dialogMode === "editGrant" && selectedGrant) {
        const updated = await updateAiModelGrant(selectedGrant.id, payload);
        await reload(updated.id);
        setFeedback({ tone: "success", key: "feedback.grantUpdated" });
      }

      setDialogMode(null);
    } catch {
      setFeedback({ tone: "error", key: "feedback.grantSaveError" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleGrant(grant: AiModelGrantRecord) {
    setSubmitting(true);
    resetFeedback();

    try {
      const updated = await setAiModelGrantActive(
        grant.id,
        !isEnabled(grant.state),
      );
      await reload(updated.id);
      setFeedback({
        tone: "success",
        key: isEnabled(updated.state)
          ? "feedback.grantEnabled"
          : "feedback.grantDisabled",
      });
    } catch {
      setFeedback({ tone: "error", key: "feedback.grantStateError" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ViewLayout className="vx-tenant-management-page vx-model-strategy-page">
      <PageHeader
        icon="shield-check"
        eyebrow={t("header.eyebrow")}
        title={t("header.title")}
        description={t("header.description")}
        secondary={<Badge>{t("header.badge")}</Badge>}
      />

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
            id: "policies",
            help: t("summary.policiesHelp"),
            icon: "shield-check",
            label: t("summary.policies"),
            value: formatNumber(policies.length),
            tags: [`${t("filters.usable")} ${formatNumber(usablePolicies)}`],
          },
          {
            id: "overrides",
            help: t("summary.overridesHelp"),
            icon: "play",
            label: t("overrides.title"),
            value: formatNumber(grants.length),
            tags: [
              `${t("status.active")} ${formatNumber(grants.filter((grant) => isEnabled(grant.state)).length)}`,
              `平台主体 ${formatNumber(platformPolicyCount)}`,
            ],
            tone: "success",
          },
          {
            id: "undefined",
            help: t("summary.undefinedPoliciesHelp"),
            icon: "clock-counter-clockwise",
            label: t("summary.undefinedPolicies"),
            value: formatNumber(undefinedPolicies),
            tags: [t("filters.undefined")],
            tone: undefinedPolicies ? "warning" : "success",
          },
        ]}
      />

      <div className="grid min-w-0">
        <section
          className="vx-tenant-toolbar"
          aria-label={t("policyTable.filterAriaLabel")}
        >
          <ViewModeSwitch
            value={viewMode}
            onChange={setViewMode}
            ariaLabel="模型授权展示方式"
          />
          <span className="inline-flex min-h-control-lg items-center pl-xs text-body-md font-extrabold whitespace-nowrap text-foreground max-[60rem]:mr-auto">
            {formatNumber(filteredPolicies.length)}
          </span>
          <span className="flex-1 max-[60rem]:hidden" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("policyTable.searchPlaceholder")}
            className="grow basis-media-3xl max-w-panel-sm"
            aria-label={t("policyTable.searchAriaLabel")}
          />
          <Button
            variant="outline"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            重置
          </Button>
          <>
            <NativeSelect
              className="w-fit basis-media-xl"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as PolicyFilter)
              }
              aria-label={t("policyTable.filterAriaLabel")}
            >
              {filters.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </>
          <ActionButton icon="plus" onClick={openCreateGrantDialog}>
            {t("actions.addGrant")}
          </ActionButton>
        </section>

        <section
          className="grid min-w-0 max-w-full gap-xs"
          aria-label={t("policyTable.toolbarTitle", {
            count: filteredPolicies.length,
          })}
        >
          {viewMode === "list" ? (
            <DataTable
              columns={policyColumns}
              rows={pagedPolicies}
              rowKey={(policy) => policy.id}
              loading={loading}
              indexStart={pageStart + 1}
              selectedKeys={[...selectedPolicyIds]}
              onSelectionChange={(keys) => setSelectedPolicyIds(new Set(keys))}
              rowActions={(policy) => (
                <ActionMenu
                  label={`${policy.scopeName} 操作`}
                  items={[
                    {
                      id: "readonly",
                      label: "策略只读",
                      icon: "shield-check",
                      disabled: true,
                    },
                  ]}
                />
              )}
              empty={
                loadFailed ? (
                  /* 读取失败与"筛选没匹配上"是两回事。混成一种，界面就会在数据
                     源挂掉时说"没有符合条件的策略"，还引导去重置一个与此无关的
                     筛选器（2026-08-07 走查：Model Platform 未启动时所见）。 */
                  <EmptyState
                    icon="warning"
                    title={t("empty.loadFailedTitle")}
                    description={t("empty.loadFailedDescription")}
                  />
                ) : (
                  <EmptyState
                    title={t("empty.policyTitle")}
                    description={t("empty.policyDescription")}
                    action={
                      <ActionButton
                        variant="outline"
                        icon="x"
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                        }}
                      >
                        {t("empty.resetFilters")}
                      </ActionButton>
                    }
                  />
                )
              }
            />
          ) : pagedPolicies.length ? (
            <div
              className="vx-tenant-directory-cards vx-model-strategy-cards"
              aria-label={t("policyTable.toolbarTitle", {
                count: filteredPolicies.length,
              })}
            >
              {pagedPolicies.map((policy) => {
                const model = policy.modelCode
                  ? modelByCode.get(policy.modelCode)
                  : undefined;
                const status = policyStatus(policy);
                const modelName = policy.modelCode
                  ? (model?.modelName ?? policy.modelCode)
                  : t("policyTable.undefinedModel");
                const modelCode =
                  policy.modelCode ?? t("policyTable.defaultDeny");

                return (
                  <article
                    key={policy.id}
                    className={`vx-tenant-directory-card vx-model-strategy-card vx-model-strategy-card--${status}`}
                  >
                    <header>
                      <Icon
                        name="shield-check"
                        size={24}
                        fallback="placeholder"
                      />
                      <div>
                        <strong>{policy.scopeName}</strong>
                        <span>
                          {policySubjectLabel(policy)} · {policy.scopeCode}
                        </span>
                      </div>
                      <StatusBadge tone={POLICY_STATUS_TONE[status]}>
                        {t(`status.${status}`)}
                      </StatusBadge>
                    </header>
                    <div className="flex flex-wrap items-center gap-xs">
                      <Badge>{modelName}</Badge>
                      <Badge>
                        {formatTokens(
                          policy.quotaTokens,
                          policy.isUnlimited,
                          t("policyTable.unlimited"),
                        )}
                      </Badge>
                    </div>
                    <div className="vx-tenant-directory-card__metrics">
                      <span>
                        <b>{policy.priority}</b>
                        <small>{t("policyTable.columns.priority")}</small>
                      </span>
                      <span>
                        <b>{policy.agentName}</b>
                        <small>
                          {policy.agentCode ?? t("table.allAgents")}
                        </small>
                      </span>
                      <span>
                        <b>{modelCode}</b>
                        <small>{t("policyTable.columns.model")}</small>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={loading ? t("empty.loadingTitle") : t("empty.policyTitle")}
              description={
                loading
                  ? t("empty.loadingDescription")
                  : t("empty.policyDescription")
              }
              action={
                <ActionButton
                  variant="outline"
                  icon="x"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  {t("empty.resetFilters")}
                </ActionButton>
              }
            />
          )}

          {/* 这一页不给用户改每页条数，用 DS Pagination 本体即可，不经 ListPagination
              （那件的存在理由是档位集与类型窄化，这里两样都用不上）。 */}
          <Pagination
            page={safeCurrentPage}
            pageCount={totalPages}
            countLabel={t("pagination.policySummary", {
              page: safeCurrentPage,
              totalPages,
              total: filteredPolicies.length,
            })}
            onPageChange={setCurrentPage}
          />
        </section>
      </div>

      <section className="grid min-w-0 vx-model-strategy-overrides">
        <header className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground vx-model-strategy-overrides__header">
          <strong>{t("overrides.title")}</strong>
          <span>
            {t("overrides.count", { count: filteredOverrides.length })}
          </span>
        </header>

        <DataTable
          columns={overrideColumns}
          rows={visibleOverrideGrants}
          rowKey={(grant) => grant.id}
          loading={loading}
          indexStart={1}
          selectedKeys={[...selectedGrantIds]}
          onSelectionChange={(keys) => setSelectedGrantIds(new Set(keys))}
          rowActions={(grant) => (
            <ActionMenu
              label={t("actions.grantMenu")}
              items={[
                {
                  id: "edit",
                  label: t("actions.editGrant"),
                  icon: "edit",
                  onSelect: () => openEditGrantDialog(grant),
                },
                {
                  id: "toggle",
                  label: isEnabled(grant.state)
                    ? t("actions.disableGrant")
                    : t("actions.enableGrant"),
                  icon: isEnabled(grant.state) ? "x" : "check",
                  disabled: submitting,
                  onSelect: () => void handleToggleGrant(grant),
                },
              ]}
            />
          )}
          empty={
            <EmptyState
              title={t("empty.overrideTitle")}
              description={t("empty.overrideDescription")}
            />
          }
        />
      </section>

      {dialogMode === "createGrant" || dialogMode === "editGrant" ? (
        <DialogForm
          open
          title={t(`dialogs.${dialogMode}.title`)}
          submitLabel={t("dialogs.actions.save")}
          cancelLabel={t("dialogs.actions.cancel")}
          submitting={submitting}
          onOpenChange={(open) => {
            if (!open) setDialogMode(null);
          }}
          onSubmit={(event) => void submitGrant(event)}
        >
          <div className="vx-model-dialog__grid">
            <Label>
              {t("dialogs.fields.grantModel")}
              <NativeSelect
                value={grantForm.modelId}
                disabled={dialogMode === "editGrant"}
                onChange={(event) =>
                  setGrantForm((old) => ({
                    ...old,
                    modelId: event.target.value,
                  }))
                }
                required
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelName}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              {t("dialogs.fields.tenantId")}
              <Input
                value={grantForm.tenantId}
                disabled={dialogMode === "editGrant"}
                onChange={(event) =>
                  setGrantForm((old) => ({
                    ...old,
                    tenantId: event.target.value,
                  }))
                }
                required
              />
            </Label>
          </div>
          <div className="vx-model-dialog__grid">
            <Label>
              {t("dialogs.fields.agentId")}
              {/* 与 模型 / 租户 同列：应用范围是身份的一部分，创建后 atlas 不接受修改。
                  改范围 = 停用这条 + 新建一条，两个决定都留在审计里。 */}
              <NativeSelect
                value={grantForm.agentId}
                disabled={dialogMode === "editGrant"}
                onChange={(event) =>
                  setGrantForm((old) => ({
                    ...old,
                    agentId: event.target.value,
                  }))
                }
              >
                <option value="">{t("table.allAgents")}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.agentName}
                  </option>
                ))}
              </NativeSelect>
            </Label>
            <Label>
              {t("dialogs.fields.priority")}
              <Input
                type="number"
                value={grantForm.priority}
                onChange={(event) =>
                  setGrantForm((old) => ({
                    ...old,
                    priority: event.target.value,
                  }))
                }
                required
              />
            </Label>
          </div>
          {/* 任务画像与授权说明同列：两个都是自由文本、两个在编辑态都照常可改
              （与上面那行的应用范围不同——那个 atlas 创建后就不收了）。 */}
          <div className="vx-model-dialog__grid">
            <Label>
              {t("dialogs.fields.taskProfile")}
              {/* atlas 的 create 与 update 都收这个字段，而此前表单里根本没有它：
                  于是一条按任务画像点名路由的授权，在管理面上既配不出来、也改不了。 */}
              <Input
                value={grantForm.taskProfile}
                onChange={(event) =>
                  setGrantForm((old) => ({
                    ...old,
                    taskProfile: event.target.value,
                  }))
                }
                placeholder={t("dialogs.hints.taskProfilePlaceholder")}
              />
            </Label>
            <Label>
              {t("dialogs.fields.reason")}
              <Input
                value={grantForm.reason}
                onChange={(event) =>
                  setGrantForm((old) => ({
                    ...old,
                    reason: event.target.value,
                  }))
                }
              />
            </Label>
          </div>
          <div className="vx-model-dialog__grid">
            <Label>
              {t("dialogs.fields.expiresAt")}
              <Input
                type="date"
                value={grantForm.expiresAt}
                onChange={(event) =>
                  setGrantForm((old) => ({
                    ...old,
                    expiresAt: event.target.value,
                  }))
                }
              />
            </Label>
            {/* **只在新建时出现。**
                编辑态这个勾以前也在，但它什么都不做：atlas 的更新 body 里根本没有状态
                字段，勾了保存，值被静默丢掉，界面还显示成功。启停只走具名动作
                （行操作里的启用/停用），那是 atlas 有意的设计——`AuditMiddleware` 从路径
                推导 action，用 update 改状态会被记成 `action='update'`，于是按
                `?action=deactivate` 检索的审计员一条都查不到。 */}
            {dialogMode === "createGrant" ? (
              <label className="vx-model-dialog__check">
                <Checkbox
                  checked={grantForm.isActive}
                  onCheckedChange={(checked) =>
                    setGrantForm((old) => ({
                      ...old,
                      isActive: checked === true,
                    }))
                  }
                />
                {t("dialogs.fields.grantActive")}
              </label>
            ) : (
              <Banner
                tone="info"
                title={t("dialogs.hints.grantStateViaRowAction")}
              />
            )}
          </div>
        </DialogForm>
      ) : null}
    </ViewLayout>
  );
}
