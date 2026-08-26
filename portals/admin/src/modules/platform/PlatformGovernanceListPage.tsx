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

const statusMeta = {
  normal: { label: "正常", icon: "check", tone: "success" },
  warning: { label: "关注", icon: "info", tone: "warning" },
  blocked: { label: "阻断", icon: "x", tone: "danger" },
  pending: { label: "待处理", icon: "clock", tone: "warning" },
} satisfies Record<PlatformGovernanceStatus, StatusMeta>;

/* 审批中心的四档说的是审批流的位置，不是对象健康度，故另给一套文案；语气同源。 */
const approvalStatusMeta = {
  normal: { label: "已完成", icon: "check", tone: "success" },
  warning: { label: "待执行", icon: "info", tone: "warning" },
  blocked: { label: "已阻断", icon: "x", tone: "danger" },
  pending: { label: "待审批", icon: "clock", tone: "warning" },
} satisfies Record<PlatformGovernanceStatus, StatusMeta>;

const governanceConfigs = {
  admins: {
    title: "平台用户",
    description:
      "管理平台内部管理员、运营人员和运维人员，明确岗位、角色、准入状态和最近访问。",
    icon: "user",
    primaryAction: "新增人员",
    batchAction: "批量审计",
    searchPlaceholder: "搜索人员、岗位、角色或职责",
    objectLabel: "人员",
    scopeLabel: "岗位",
    ownerLabel: "角色",
    policyLabel: "准入策略",
    summary: {
      total: { label: "人员总数", tag: "全部账号" },
      normal: { label: "正常可用", tag: "可登录" },
      risk: { label: "风险关注", tag: "需核查" },
      pending: { label: "待处理", tag: "队列" },
    },
    actions: { detail: "查看详情", edit: "编辑人员", audit: "审计记录" },
  },
  secrets: {
    title: "密钥管理",
    description: "集中管理平台级 API Key、服务凭据、轮换周期和最小可见范围。",
    icon: "key",
    primaryAction: "新增密钥",
    batchAction: "批量审计",
    searchPlaceholder: "搜索密钥、用途、负责人或策略",
    objectLabel: "密钥",
    scopeLabel: "作用域",
    ownerLabel: "负责人",
    policyLabel: "轮换策略",
    summary: {
      total: { label: "密钥总数", tag: "全部配置" },
      normal: { label: "正常可用", tag: "可使用" },
      risk: { label: "风险关注", tag: "需处理" },
      pending: { label: "待处理", tag: "队列" },
    },
    actions: { detail: "查看详情", edit: "编辑配置", audit: "审计记录" },
  },
  jobs: {
    title: "任务调度",
    description: "观察平台异步任务、重试、死信、调度状态和关键后台作业。",
    icon: "workflow",
    primaryAction: "新增任务",
    batchAction: "批量审计",
    searchPlaceholder: "搜索任务、队列、负责人或策略",
    objectLabel: "任务",
    scopeLabel: "队列",
    ownerLabel: "负责人",
    policyLabel: "调度策略",
    summary: {
      total: { label: "任务总数", tag: "全部队列" },
      normal: { label: "正常运行", tag: "可调度" },
      risk: { label: "风险关注", tag: "需处置" },
      pending: { label: "待处理", tag: "队列" },
    },
    actions: { detail: "查看详情", edit: "编辑任务", audit: "执行记录" },
  },
  approvals: {
    title: "审批中心",
    description: "承接高风险操作的二次确认、审批流、执行凭证和审计闭环。",
    icon: "check",
    primaryAction: "新增审批",
    batchAction: "批量复核",
    searchPlaceholder: "搜索审批、对象、发起人或策略",
    objectLabel: "审批事项",
    scopeLabel: "对象",
    ownerLabel: "发起人",
    policyLabel: "审批策略",
    summary: {
      total: { label: "审批总数", tag: "高风险操作" },
      normal: { label: "已完成", tag: "审计可查" },
      risk: { label: "待执行", tag: "需跟进" },
      pending: { label: "待审批", tag: "队列" },
    },
    actions: { detail: "查看详情", edit: "审批处理", audit: "审计凭证" },
  },
} satisfies Record<PlatformGovernanceKind, GovernanceConfig>;

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
) {
  return kind === "approvals" ? approvalStatusMeta[status] : statusMeta[status];
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
  const config = governanceConfigs[kind];
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
          const meta = governanceStatusMeta(kind, record.status);
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
                help: `当前${config.objectLabel}记录总数，不区分状态。`,
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
                  ...(!summary.risk && !summary.pending ? ["无待处理"] : []),
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
              className="vx-tenant-search"
              aria-label={`搜索${config.objectLabel}`}
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
          <div className="vx-tenant-filters">
            <NativeSelect
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as PlatformGovernanceStatus | "all",
                )
              }
              className="vx-input vx-tenant-select"
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
          </div>
        </FilterBar>
      }
      table={
        <section
          className="vx-tenant-directory vx-platform-governance-directory"
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
                    title={`还没有${config.objectLabel}`}
                    description={`新增后会出现在这里。`}
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
                const meta = governanceStatusMeta(kind, record.status);
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
              title={`还没有${config.objectLabel}`}
              description={`新增后会出现在这里。`}
            />
          )}
        </section>
      }
    />
  );
}
