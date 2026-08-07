"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  Pagination,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import { fetchSkills } from "@/api/admin-bff";
import type { SkillRecord } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type SkillStatusFilter = SkillRecord["status"] | "all";
type ViewMode = "list" | "cards";

const PAGE_SIZE = 20;
const EMPTY_MARK = "-";

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<SkillRecord["status"], string> = {
  active: "已上线",
  disabled: "已停用",
  draft: "草稿",
};

function skillSearchText(skill: SkillRecord) {
  return [
    skill.skillCode,
    skill.skillName,
    skill.description,
    skill.category,
    skill.version,
    skill.endpointUrl,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// ─── 子组件：汇总卡片 ──────────────────────────────────────────────────────────

function SkillSummary({ skills }: { skills: SkillRecord[] }) {
  const activeCount = skills.filter((s) => s.status === "active").length;
  const disabledCount = skills.filter((s) => s.status === "disabled").length;
  const totalInvocations = skills.reduce((sum, s) => sum + s.invocations, 0);

  return (
    <MetricGrid
      aria-label="技能市场统计"
      columns={3}
      items={[
        {
          id: "active",
          help: "状态为已上线、可被调用的技能。",
          icon: "cube",
          label: "已上线技能",
          value: String(activeCount),
        },
        {
          id: "disabled",
          help: "已停用、不再对外提供的技能。",
          icon: "x",
          label: "已停用技能",
          value: String(disabledCount),
          tone: disabledCount ? "warning" : "neutral",
        },
        {
          id: "invocations",
          help: "全部技能的历史调用次数之和。",
          icon: "sparkles",
          label: "总调用次数",
          value: formatNumber(totalInvocations),
        },
      ]}
    />
  );
}

// ─── 子组件：工具栏 ────────────────────────────────────────────────────────────

function SkillToolbar({
  search,
  statusFilter,
  categoryFilter,
  categories,
  viewMode,
  total,
  onSearchChange,
  onStatusFilterChange,
  onCategoryFilterChange,
  onViewModeChange,
}: {
  search: string;
  statusFilter: SkillStatusFilter;
  categoryFilter: string;
  categories: string[];
  viewMode: ViewMode;
  total: number;
  onSearchChange: (v: string) => void;
  onStatusFilterChange: (v: SkillStatusFilter) => void;
  onCategoryFilterChange: (v: string) => void;
  onViewModeChange: (v: ViewMode) => void;
}) {
  return (
    <FilterBar
      view={viewMode}
      onViewChange={onViewModeChange}
      cardsDisabledReason="卡片视图已停用：列表视图提供选择、排序、分页与跨页批量，运营台的清单是拿来扫读和对比的。"
      count={`${total} 个技能`}
      aria-label="技能筛选"
      search={
        <Input
          className="vx-tenant-search"
          type="search"
          placeholder="搜索技能名称、代码、描述…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      }
      onReset={() => {
        onSearchChange("");
        onStatusFilterChange("all");
        onCategoryFilterChange("");
      }}
    >
      <NativeSelect
        wrapperClassName="w-fit"
        className="vx-tenant-select"
        value={statusFilter}
        onChange={(e) =>
          onStatusFilterChange(e.target.value as SkillStatusFilter)
        }
        aria-label="技能状态"
      >
        <option value="all">全部状态</option>
        <option value="active">已上线</option>
        <option value="disabled">已停用</option>
        <option value="draft">草稿</option>
      </NativeSelect>
      {categories.length > 0 ? (
        <NativeSelect
          wrapperClassName="w-fit"
          className="vx-tenant-select"
          value={categoryFilter}
          onChange={(e) => onCategoryFilterChange(e.target.value)}
          aria-label="技能分类"
        >
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
      ) : null}
    </FilterBar>
  );
}

// ─── 列表列定义 ───────────────────────────────────────────────────────────────

/**
 * 状态标换 `StatusBadge`：技能的三档状态原先借用了 `vx-admin-role-status-pill--*`
 * 与 `vx-platform-user-status-pill--pending`——那是另外两个域的着色类，跨域借用
 * 一旦批 4 重排那两族就会跟着变。它本身是页面自己的三档语气，归 DS 语气即可。
 */
const SKILL_STATUS_TONE: Record<SkillRecord["status"], StatusBadgeTone> = {
  active: "success",
  disabled: "neutral",
  draft: "info",
};

const SKILL_COLUMNS: readonly DataTableColumn<SkillRecord>[] = [
  {
    id: "skill",
    header: "技能",
    cell: (skill) => (
      <TableTitleCell title={skill.skillName} description={skill.skillCode} />
    ),
  },
  { id: "category", header: "分类", cell: (skill) => skill.category },
  { id: "version", header: "版本", cell: (skill) => skill.version },
  {
    id: "endpoint",
    header: "调用端点",
    cell: (skill) => (
      <span title={skill.endpointUrl ?? EMPTY_MARK}>
        {skill.endpointUrl ?? EMPTY_MARK}
      </span>
    ),
  },
  {
    id: "invocations",
    header: "调用次数",
    align: "right",
    cell: (skill) => formatNumber(skill.invocations),
  },
  {
    id: "status",
    header: "状态",
    align: "center",
    cell: (skill) => (
      <span className="inline-flex flex-wrap items-center justify-center gap-2xs">
        <StatusBadge tone={SKILL_STATUS_TONE[skill.status]}>
          {STATUS_LABELS[skill.status]}
        </StatusBadge>
        {skill.isSystem ? <StatusBadge tone="info">系统</StatusBadge> : null}
      </span>
    ),
  },
  {
    id: "updated",
    header: "更新时间",
    cell: (skill) => formatDate(skill.updatedAt),
  },
];

// ─── 子组件：卡片视图 ──────────────────────────────────────────────────────────

function SkillCards({ skills }: { skills: SkillRecord[] }) {
  return (
    <div className="vx-skills-cards">
      {skills.map((skill) => (
        <div key={skill.id} className="vx-skill-card">
          <div className="vx-skill-card__header">
            <span className="vx-skill-card__icon">
              <Icon name="cube" size="md" fallback="placeholder" />
            </span>
            <div className="vx-skill-card__badges">
              <StatusBadge tone={SKILL_STATUS_TONE[skill.status]}>
                {STATUS_LABELS[skill.status]}
              </StatusBadge>
              {skill.isSystem && <StatusBadge tone="info">系统</StatusBadge>}
            </div>
          </div>
          <h3 className="vx-skill-card__name">{skill.skillName}</h3>
          <p className="vx-skill-card__code">{skill.skillCode}</p>
          <p className="vx-skill-card__description">{skill.description}</p>
          <div className="vx-skill-card__meta">
            <span>{skill.category}</span>
            <span>v{skill.version}</span>
            <span>{formatNumber(skill.invocations)} 次调用</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SkillStatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchSkills()
      .then(setSkills)
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => [...new Set(skills.map((s) => s.category))].sort(),
    [skills],
  );

  const filtered = useMemo(() => {
    let result = skills;
    if (statusFilter !== "all")
      result = result.filter((s) => s.status === statusFilter);
    if (categoryFilter)
      result = result.filter((s) => s.category === categoryFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((s) => skillSearchText(s).includes(q));
    }
    return result;
  }, [skills, search, statusFilter, categoryFilter]);

  const pageSkills = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const handleStatusFilter = (v: SkillStatusFilter) => {
    setStatusFilter(v);
    setPage(1);
  };
  const handleCategoryFilter = (v: string) => {
    setCategoryFilter(v);
    setPage(1);
  };

  return (
    <>
      <ListPageTemplate
        className="vx-skills-page"
        header={
          <PageHeader
            icon="cube"
            title="技能市场"
            description="注册和管理智能体可调用技能，配置上下线、端点和运行状态。"
          />
        }
        summary={<SkillSummary skills={skills} />}
        filters={
          <SkillToolbar
            search={search}
            statusFilter={statusFilter}
            categoryFilter={categoryFilter}
            categories={categories}
            viewMode={viewMode}
            total={filtered.length}
            onSearchChange={handleSearch}
            onStatusFilterChange={handleStatusFilter}
            onCategoryFilterChange={handleCategoryFilter}
            onViewModeChange={setViewMode}
          />
        }
        table={
          viewMode === "list" ? (
            <DataTable
              columns={SKILL_COLUMNS}
              rows={pageSkills}
              rowKey={(skill) => skill.id}
              loading={loading}
              indexStart={(page - 1) * PAGE_SIZE + 1}
              rowActions={(skill) => (
                <Button
                  variant="ghost"
                  size="icon-md"
                  disabled={skill.isSystem}
                  title={
                    skill.isSystem ? "系统技能不可修改" : "操作（数据层待接入）"
                  }
                >
                  <Icon name="more-vertical" size="lg" fallback="placeholder" />
                </Button>
              )}
              empty={
                <EmptyState
                  title="暂无技能"
                  description={
                    search || statusFilter !== "all" || categoryFilter
                      ? "尝试调整筛选条件"
                      : "尚未接入任何 AI 技能，请通过 API 注册技能"
                  }
                />
              }
              footer={
                pageCount > 1 ? (
                  <Pagination
                    page={page}
                    pageCount={pageCount}
                    total={filtered.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setPage}
                  />
                ) : null
              }
            />
          ) : loading ? (
            <EmptyState title="加载中…" />
          ) : pageSkills.length ? (
            <>
              <SkillCards skills={pageSkills} />
              {pageCount > 1 ? (
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  total={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              ) : null}
            </>
          ) : (
            <EmptyState
              title="暂无技能"
              description={
                search || statusFilter !== "all" || categoryFilter
                  ? "尝试调整筛选条件"
                  : "尚未接入任何 AI 技能，请通过 API 注册技能"
              }
            />
          )
        }
      />
    </>
  );
}
