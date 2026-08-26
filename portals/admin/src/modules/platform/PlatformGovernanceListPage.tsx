"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
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
import type {
  DataTableColumn,
  IconName,
  StatusBadgeTone,
} from "@vxture/design-system";
import { fetchPlatformGovernanceRecords } from "@/api/admin-bff";
import type {
  PlatformGovernanceKind,
  PlatformGovernanceRecord,
  PlatformGovernanceStatus,
} from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatNumber, joinClasses } from "@/modules/tenants/tenant-utils";

type ViewMode = "list" | "cards";

interface GovernanceConfig {
  title: string;
  description: string;
  icon: IconName;
  primaryAction: string;
  batchAction: string;
  searchPlaceholder: string;
  objectLabel: string;
  scopeLabel: string;
  ownerLabel: string;
  policyLabel: string;
  summary: {
    total: { label: string; tag: string };
    normal: { label: string; tag: string };
    risk: { label: string; tag: string };
    pending: { label: string; tag: string };
  };
  actions: {
    detail: string;
    edit: string;
    audit: string;
  };
}

type StatusMeta = { label: string; icon: IconName; tone: StatusBadgeTone };

/* 图标与语气留在代码里，文案进词条。
 *
 * 这两样性质不同：`icon` / `tone` 是视觉判断（「阻断」用 danger 是产品对严重度的
 * 表态），与语言无关，改它要过评审；`label` 是文案，改它只是翻译。焊在一起的
 * 后果是文案没法翻译，而判断被当成文案——与 opera `status.ts` 那次同一判据。 */
const STATUS_VISUAL = {
  normal: { icon: "check", tone: "success" },
  warning: { icon: "info", tone: "warning" },
  blocked: { icon: "x", tone: "danger" },
  pending: { icon: "clock", tone: "warning" },
} satisfies Record<PlatformGovernanceStatus, Omit<StatusMeta, "label">>;

/* 审批中心的四档说的是审批流的位置，不是对象健康度，故另给一套文案；语气同源
   （视觉与上面共用 `STATUS_VISUAL`，只有文案分叉）。 */
const GOVERNANCE_ICONS = {
  admins: "user",
  secrets: "key",
  jobs: "workflow",
  approvals: "check",
} satisfies Record<PlatformGovernanceKind, IconName>;

type TFn = ReturnType<typeof useTranslations>;

/* 从常量改成工厂：常量在模块加载时求值，那一刻拿不到 `t`。 */
function governanceConfig(
  kind: PlatformGovernanceKind,
  t: TFn,
): GovernanceConfig {
  const k = (suffix: string) => t(`platformGovernance.${kind}.${suffix}`);
  return {
    title: k("title"),
    description: k("description"),
    icon: GOVERNANCE_ICONS[kind],
    primaryAction: k("primaryAction"),
    batchAction: k("batchAction"),
    searchPlaceholder: k("searchPlaceholder"),
    objectLabel: k("objectLabel"),
    scopeLabel: k("scopeLabel"),
    ownerLabel: k("ownerLabel"),
    policyLabel: k("policyLabel"),
    summary: {
      total: { label: k("summary.totalLabel"), tag: k("summary.totalTag") },
      normal: { label: k("summary.normalLabel"), tag: k("summary.normalTag") },
      risk: { label: k("summary.riskLabel"), tag: k("summary.riskTag") },
      pending: {
        label: k("summary.pendingLabel"),
        tag: k("summary.pendingTag"),
      },
    },
    actions: {
      detail: k("actions.detail"),
      edit: k("actions.edit"),
      audit: k("actions.audit"),
    },
  };
}

function recordSearchText(record: PlatformGovernanceRecord) {
  return [
    record.id,
    record.name,
    record.scope,
    record.owner,
    record.policy,
    record.description,
    ...record.tags,
  ]
    .join(" ")
    .toLowerCase();
}

function governanceStatusMeta(
  kind: PlatformGovernanceKind,
  status: PlatformGovernanceStatus,
  t: TFn,
): StatusMeta {
  const ns = kind === "approvals" ? "approvalStatus" : "status";
  return {
    ...STATUS_VISUAL[status],
    label: t(`platformGovernance.${ns}.${status}`),
  };
}

function GovernanceActionsMenu({
  record,
  labels,
}: {
  record: PlatformGovernanceRecord;
  labels: GovernanceConfig["actions"];
}) {
  return (
    <ActionMenu
      label={`${record.name} 操作`}
      items={[
        { id: "detail", label: labels.detail, icon: "info", disabled: true },
        { id: "edit", label: labels.edit, icon: "edit", disabled: true },
        {
          id: "audit",
          label: labels.audit,
          icon: "shield-check",
          disabled: true,
        },
      ]}
    />
  );
}

export function PlatformGovernanceListPage({
  kind,
}: {
  kind: PlatformGovernanceKind;
}) {
  const tShared = useTranslations();
  /* 钉住：工厂每次调用都新建一个对象，而下面 `columns` 的 memo 依赖里就有
     `config`——不 memo 的话那个 memo 每次渲染都失效，等于白写。 */
  const config = useMemo(
    () => governanceConfig(kind, tShared),
    [kind, tShared],
  );
  const [sourceRecords, setSourceRecords] = useState<
    PlatformGovernanceRecord[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    PlatformGovernanceStatus | "all"
  >("all");
  /**
   * 当前是否真的有筛选在生效。
   *
   * 没有它就只能说一句话，而空表有两种原因：**被筛没了**和**本来就没有**。
   * 审批中心、任务调度、密钥管理三页在零条时都写着"调整关键词或筛选条件后再查看"
   * 并给一个重置按钮，可当时根本没有筛选——把用户支去做一件无济于事的操作
   * （2026-08-07 走查）。
   */
  const hasActiveFilters = query.trim() !== "" || statusFilter !== "all";

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const records = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sourceRecords.filter((record) => {
      const matchesQuery =
        !normalizedQuery || recordSearchText(record).includes(normalizedQuery);
      const matchesStatus =
        statusFilter === "all" || record.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, sourceRecords, statusFilter]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    fetchPlatformGovernanceRecords(kind)
      .then((nextRecords) => {
        if (!active) return;
        setSourceRecords(nextRecords);
      })
      .catch((error) => {
        if (!active) return;
        setSourceRecords([]);
        setLoadError(
          error instanceof Error
            ? error.message
            : `${config.title}数据读取失败`,
        );
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [config.title, kind]);

  const columns = useMemo<DataTableColumn<PlatformGovernanceRecord>[]>(
    () => [
      {
        id: "identity",
        header: config.objectLabel,
        cell: (record) => (
          <TableTitleCell
            icon={config.icon}
            title={record.name}
            description={record.description}
          />
        ),
      },
      {
        id: "status",
        header: tShared("columns.state"),
        align: "center",
        cell: (record) => {
          const meta = governanceStatusMeta(kind, record.status, tShared);
          return (
            <StatusBadge tone={meta.tone} icon={meta.icon}>
              {meta.label}
            </StatusBadge>
          );
        },
      },
      {
        id: "scope",
        header: config.scopeLabel,
        align: "center",
        cell: (record) => <Badge>{record.scope}</Badge>,
      },
      {
        id: "owner",
        header: config.ownerLabel,
        cell: (record) => (
          <TableTitleCell title={record.owner} description={record.updatedAt} />
        ),
      },
      {
        id: "policy",
        header: config.policyLabel,
        cell: (record) => (
          <TableTitleCell
            title={record.policy}
            description={record.tags.join(" / ")}
          />
        ),
      },
    ],
    /* `tShared` 要进依赖：列头 `columns.state` 从它取。next-intl 的 translator 按
       (命名空间, messages, locale) 记忆化，只在切语言时换身份——所以这不会让 memo
       每次渲染失效，反而保证切语言时列头真的跟着变。这里没有 effect 依赖
       `columns`，不存在把 t 加进依赖会无限重跑的风险。 */
    [config, kind, tShared],
  );

  function resetFilters() {
    setQuery("");
    setStatusFilter("all");
  }

  const summary = {
    total: sourceRecords.length,
    normal: sourceRecords.filter((record) => record.status === "normal").length,
    risk: sourceRecords.filter(
      (record) => record.status === "warning" || record.status === "blocked",
    ).length,
    pending: sourceRecords.filter((record) => record.status === "pending")
      .length,
  };

  return (
    <ListPageTemplate
      className={joinClasses(
        "vx-tenant-management-page vx-platform-governance-page",
        `vx-platform-governance-page--${kind}`,
      )}
      header={
        <PageHeader
          icon={config.icon}
          title={config.title}
          description={config.description}
        />
      }
      summary={
        <>
          {" "}
          <MetricGrid
            loading={loading}
            aria-label={`${config.title}统计`}
            columns={3}
            items={[
              {
                id: "total",
                help: tShared("platformGovernance.totalHelp", {
                  object: config.objectLabel,
                }),
                icon: config.icon,
                label: config.summary.total.label,
                value: formatNumber(summary.total),
                tags: [config.summary.total.tag],
              },
              {
                id: "normal",
                help: "状态为正常、无需干预的记录。",
                icon: "check",
                label: config.summary.normal.label,
                value: formatNumber(summary.normal),
                tags: [config.summary.normal.tag],
                tone: "success",
              },
              {
                id: "risk",
                help: "状态为关注或阻断，加上待处理的记录合计。",
                icon: "info",
                label: config.summary.risk.label,
                value: formatNumber(summary.risk + summary.pending),
                tags: [
                  ...(summary.risk
                    ? [
                        `${config.summary.risk.tag} ${formatNumber(summary.risk)}`,
                      ]
                    : []),
                  ...(summary.pending
                    ? [
                        `${config.summary.pending.tag} ${formatNumber(summary.pending)}`,
                      ]
                    : []),
                  ...(!summary.risk && !summary.pending
                    ? [tShared("platformGovernance.noPending")]
                    : []),
                ],
                tone: "warning",
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
          count={formatNumber(records.length)}
          aria-label={`${config.title}筛选`}
          search={
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={config.searchPlaceholder}
              className="grow basis-media-3xl max-w-panel-sm"
              aria-label={tShared("platformGovernance.searchAria", {
                object: config.objectLabel,
              })}
            />
          }
          onReset={resetFilters}
          actions={
            <>
              <ActionButton
                icon="shield-check"
                variant="outline"
                disabled={selectedIds.size === 0}
              >
                {config.batchAction}
                {selectedIds.size ? ` (${selectedIds.size})` : ""}
              </ActionButton>
              <ActionButton icon="plus" disabled>
                {config.primaryAction}
              </ActionButton>
            </>
          }
        >
          <>
            <NativeSelect
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as PlatformGovernanceStatus | "all",
                )
              }
              className="w-fit basis-media-xl"
              aria-label={`${config.objectLabel}状态`}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              <option value="normal">{tShared("status.generic.normal")}</option>
              <option value="warning">关注</option>
              <option value="blocked">阻断</option>
              <option value="pending">
                {tShared("status.generic.pending")}
              </option>
            </NativeSelect>
          </>
        </FilterBar>
      }
      table={
        <section
          className="grid min-w-0 max-w-full gap-xs vx-platform-governance-directory"
          aria-label={`${config.title}清单`}
        >
          {/* 读取失败是第三态，DataTable 只认加载/空/有数据，故留在外层。 */}
          {loadError ? (
            <EmptyState
              title={`${config.title}数据读取失败`}
              description={loadError}
            />
          ) : viewMode === "list" ? (
            <DataTable
              columns={columns}
              rows={records}
              rowKey={(record) => record.id}
              loading={loading}
              indexStart={1}
              selectedKeys={[...selectedIds]}
              onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
              rowActions={(record) => (
                <GovernanceActionsMenu
                  record={record}
                  labels={config.actions}
                />
              )}
              empty={
                hasActiveFilters ? (
                  <EmptyState
                    title="暂无匹配记录"
                    description="调整关键词或筛选条件后再查看。"
                    action={
                      <ActionButton
                        variant="outline"
                        icon="x"
                        onClick={resetFilters}
                      >
                        重置筛选
                      </ActionButton>
                    }
                  />
                ) : (
                  <EmptyState
                    icon="list"
                    title={tShared("platformGovernance.emptyTitle", {
                      object: config.objectLabel,
                    })}
                    description={tShared("platformGovernance.emptyDescription")}
                  />
                )
              }
            />
          ) : loading ? (
            <header className="vx-tenant-directory__header">
              <span>正在加载自治数据</span>
            </header>
          ) : records.length ? (
            <div
              className="vx-tenant-directory-cards vx-platform-governance-cards"
              aria-label={`${config.title}卡片`}
            >
              {records.map((record) => {
                const meta = governanceStatusMeta(kind, record.status, tShared);
                return (
                  <article
                    key={record.id}
                    className="vx-tenant-directory-card vx-platform-governance-card"
                  >
                    <header>
                      <Icon
                        name={config.icon}
                        size="lg"
                        fallback="placeholder"
                      />
                      <div>
                        <strong>{record.name}</strong>
                        <span>
                          {record.scope} · {record.owner}
                        </span>
                      </div>
                      <StatusBadge tone={meta.tone} icon={meta.icon}>
                        {meta.label}
                      </StatusBadge>
                    </header>
                    <p>{record.description}</p>
                    <div className="vx-platform-governance-card__tags">
                      {record.tags.map((tag) => (
                        <Badge key={tag} className="vx-tenant-pill">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <footer>
                      <span>{record.policy}</span>
                      <strong>{record.updatedAt}</strong>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : hasActiveFilters ? (
            <EmptyState
              title="暂无匹配记录"
              description="调整关键词或筛选条件后再查看。"
              action={
                <ActionButton variant="outline" icon="x" onClick={resetFilters}>
                  重置筛选
                </ActionButton>
              }
            />
          ) : (
            <EmptyState
              icon="list"
              title={tShared("platformGovernance.emptyTitle", {
                object: config.objectLabel,
              })}
              description={tShared("platformGovernance.emptyDescription")}
            />
          )}
        </section>
      }
    />
  );
}
