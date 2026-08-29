"use client";

/**
 * SkillsPage.tsx — 技能市场：Runos 能力目录的**只读**视图。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Skills
 *
 * 2026-08-30 之前这一页对着 `/api/skills` 的空桩（BFF 返回字面量 `[]`）渲染一个诚实
 * 的空态和一排禁用按钮。技能 / 能力的真实注册表一直在 Runos，opera 早已代理并管理。
 * owner 同日裁定：admin 得到 Runos 能力目录的只读视图，管理留在 opera「能力注册」。
 *
 * 所以这一页**没有任何写操作**：没有注册、没有上下线、没有编辑。唯一的"动作"是
 * 页头那条「去 opera 能力注册管理」的外链，链接由 admin-bff 按 `OPERA_BASE_URL` 拼
 * （`/api/runos/management-entry`），门户里不写任何主机名；拿不到链接就不渲染按钮。
 *
 * 数据形状照 Runos：列表是 `registry.capability` 整行，详情多 `versions` / `aliases` /
 * `endpoints` 三组关联。列表上**没有**版本与端点——那两样只在详情里有（上游列表就是
 * 一句 `findMany`），所以表格不显示"当前版本 / 端点数"这类要 N+1 才能拿到的列，
 * 点进抽屉再看。
 *
 * 文案全部走 `t()`（`skillsPage.*`）：这一页是整页重写，正好整页抽，不留半中英
 * （2026-08-27 视觉走查抓到的正是局部抽取造出的混合语言）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  DataTable,
  DetailList,
  DetailRow,
  Drawer,
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
import {
  AdminBffError,
  fetchRunosCapabilities,
  fetchRunosCapability,
  fetchRunosManagementEntry,
} from "@/api/admin-bff";
import type {
  RunosCapabilityDetailRecord,
  RunosCapabilityRecord,
  RunosManagementEntry,
} from "@/entities/console";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatDateTime } from "@/modules/tenants/tenant-utils";

// ─── 类型与词表 ────────────────────────────────────────────────────────────────

/** `t()`：next-intl 的 `useTranslations` 返回值收窄成本页用到的那一个签名。 */
type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/** runos `contract-schema.ts`：primitiveType 三选一（asset 上游仍拒绝）。 */
const PRIMITIVE_TYPES = ["connector", "executor", "skill"] as const;
/** runos 准入档，`experimental` 是非第一方 provider 的默认档。 */
const ADMISSION_TIERS = ["experimental", "certified", "official"] as const;
/** runos `incr/07` 的 15 选 1 分类法；`other` 是真实选项，不是缺省回落。 */
const CATEGORY_CODES = [
  "communication",
  "crm",
  "support",
  "devops",
  "security",
  "finance",
  "hr",
  "commerce",
  "marketing",
  "data",
  "documents",
  "productivity",
  "development",
  "legal",
  "other",
] as const;

type PrimitiveFilter = (typeof PRIMITIVE_TYPES)[number] | "all";
type TierFilter = (typeof ADMISSION_TIERS)[number] | "all";

const PAGE_SIZE = 20;

/**
 * 语气按 `status-tone.ts` 头部那张六档表定：experimental 是"正在走流程的中间态"
 * （info），certified 是达成（success），official 是第一方的强调档（brand）。
 */
const TIER_TONE: Record<string, StatusBadgeTone> = {
  experimental: "info",
  certified: "success",
  official: "brand",
};

/** runos `VERSION_STATES`：draft / submitted / admitted / stable / deprecated / withdrawn。 */
const VERSION_STATE_TONE: Record<string, StatusBadgeTone> = {
  draft: "neutral",
  submitted: "brand",
  admitted: "info",
  stable: "success",
  deprecated: "warning",
  withdrawn: "neutral",
};

/** runos `ENDPOINT_STATES`：active / draining / disabled。 */
const ENDPOINT_STATE_TONE: Record<string, StatusBadgeTone> = {
  active: "success",
  draining: "warning",
  disabled: "neutral",
};

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/**
 * `displayName` 按 locale 分键，某个 locale 缺失时回落到 `title`。**不跨 locale 回落**
 * （那会让人读到一个语言不明的名字还以为是自己那门语言的）；`en-US` → `en` 这种
 * 只是同一门语言的区域标记，算同一 locale。
 */
function displayNameFor(record: RunosCapabilityRecord, locale: string): string {
  const map = record.displayName ?? {};
  const exact = map[locale];
  if (exact) return exact;
  const language = locale.split("-")[0];
  const byLanguage = language ? map[language] : undefined;
  return byLanguage || record.title;
}

/** 词表里有的走词条，没有的原样显示——上游加了新值不该把这一格渲染成键名。 */
function labelFrom(
  t: Translate,
  namespace: string,
  known: readonly string[],
  value: string,
): string {
  return known.includes(value) ? t(`${namespace}.${value}`) : value;
}

function capabilitySearchText(record: RunosCapabilityRecord): string {
  return [
    record.capabilityId,
    record.title,
    ...Object.values(record.displayName ?? {}),
    record.providerId,
    record.ownerRef,
    record.category,
    ...(record.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof AdminBffError || error instanceof Error
    ? error.message
    : fallback;
}

// ─── 子组件：汇总卡片 ──────────────────────────────────────────────────────────

function CapabilitySummary({
  capabilities,
  loading,
}: {
  capabilities: RunosCapabilityRecord[];
  loading: boolean;
}) {
  const t = useTranslations("skillsPage");
  const skillCount = capabilities.filter(
    (c) => c.primitiveType === "skill",
  ).length;
  const certifiedCount = capabilities.filter(
    (c) => c.admissionTier === "certified" || c.admissionTier === "official",
  ).length;
  const categoryCount = new Set(
    capabilities.map((c) => c.category).filter(Boolean),
  ).size;

  return (
    <MetricGrid
      aria-label={t("summary.ariaLabel")}
      columns={4}
      loading={loading}
      items={[
        {
          id: "total",
          icon: "cube",
          label: t("summary.total"),
          help: t("summary.totalHelp"),
          value: String(capabilities.length),
        },
        {
          id: "skills",
          icon: "sparkles",
          label: t("summary.skills"),
          help: t("summary.skillsHelp"),
          value: String(skillCount),
        },
        {
          id: "certified",
          icon: "seal-check",
          label: t("summary.certified"),
          help: t("summary.certifiedHelp"),
          value: String(certifiedCount),
          tone: certifiedCount ? "success" : "neutral",
        },
        {
          id: "categories",
          icon: "squares-four",
          label: t("summary.categories"),
          help: t("summary.categoriesHelp"),
          value: String(categoryCount),
        },
      ]}
    />
  );
}

// ─── 子组件：工具栏 ────────────────────────────────────────────────────────────

function CapabilityToolbar({
  search,
  primitiveFilter,
  tierFilter,
  categoryFilter,
  categories,
  total,
  onSearchChange,
  onPrimitiveFilterChange,
  onTierFilterChange,
  onCategoryFilterChange,
}: {
  search: string;
  primitiveFilter: PrimitiveFilter;
  tierFilter: TierFilter;
  categoryFilter: string;
  categories: string[];
  total: number;
  onSearchChange: (v: string) => void;
  onPrimitiveFilterChange: (v: PrimitiveFilter) => void;
  onTierFilterChange: (v: TierFilter) => void;
  onCategoryFilterChange: (v: string) => void;
}) {
  const t = useTranslations("skillsPage");
  return (
    <FilterBar
      count={t("filters.count", { count: total })}
      aria-label={t("filters.ariaLabel")}
      search={
        <Input
          className="grow basis-media-3xl max-w-panel-sm"
          type="search"
          placeholder={t("filters.searchPlaceholder")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      }
      onReset={() => {
        onSearchChange("");
        onPrimitiveFilterChange("all");
        onTierFilterChange("all");
        onCategoryFilterChange("");
      }}
    >
      <NativeSelect
        wrapperClassName="w-fit basis-media-xl"
        value={primitiveFilter}
        onChange={(e) =>
          onPrimitiveFilterChange(e.target.value as PrimitiveFilter)
        }
        aria-label={t("filters.primitiveAria")}
      >
        <option value="all">{t("filters.allPrimitives")}</option>
        {PRIMITIVE_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(`primitive.${type}`)}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        wrapperClassName="w-fit basis-media-xl"
        value={tierFilter}
        onChange={(e) => onTierFilterChange(e.target.value as TierFilter)}
        aria-label={t("filters.tierAria")}
      >
        <option value="all">{t("filters.allTiers")}</option>
        {ADMISSION_TIERS.map((tier) => (
          <option key={tier} value={tier}>
            {t(`tier.${tier}`)}
          </option>
        ))}
      </NativeSelect>
      {categories.length > 0 ? (
        <NativeSelect
          wrapperClassName="w-fit basis-media-xl"
          value={categoryFilter}
          onChange={(e) => onCategoryFilterChange(e.target.value)}
          aria-label={t("filters.categoryAria")}
        >
          <option value="">{t("filters.allCategories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {labelFrom(t, "category", CATEGORY_CODES, c)}
            </option>
          ))}
        </NativeSelect>
      ) : null}
    </FilterBar>
  );
}

// ─── 列表列定义 ───────────────────────────────────────────────────────────────

/* 收 `t` / `locale` 的工厂而不是模块级常量：列头是词条、日期按界面语言排，
   两者在模块加载那一刻都还没有。调用方用 `useMemo` 钉住身份。 */
function capabilityColumns({
  t,
  tShared,
  locale,
  onOpen,
}: {
  t: Translate;
  tShared: Translate;
  locale: string;
  onOpen: (capabilityId: string) => void;
}): readonly DataTableColumn<RunosCapabilityRecord>[] {
  return [
    {
      id: "capability",
      header: t("columns.capability"),
      cell: (record) => (
        <TableTitleCell
          title={displayNameFor(record, locale)}
          description={record.capabilityId}
          tooltip={`${record.title} · ${record.capabilityId}`}
          onTitleClick={() => onOpen(record.capabilityId)}
        />
      ),
    },
    {
      id: "primitive",
      header: t("columns.primitive"),
      width: "sm",
      cell: (record) => (
        <Badge variant="secondary">
          {labelFrom(t, "primitive", PRIMITIVE_TYPES, record.primitiveType)}
        </Badge>
      ),
    },
    {
      id: "category",
      header: t("columns.category"),
      width: "sm",
      cell: (record) =>
        record.category
          ? labelFrom(t, "category", CATEGORY_CODES, record.category)
          : tShared("common.none"),
    },
    {
      id: "tier",
      header: t("columns.tier"),
      align: "center",
      width: "sm",
      cell: (record) => (
        <StatusBadge tone={TIER_TONE[record.admissionTier] ?? "neutral"}>
          {labelFrom(t, "tier", ADMISSION_TIERS, record.admissionTier)}
        </StatusBadge>
      ),
    },
    {
      id: "provider",
      header: t("columns.provider"),
      width: "sm",
      cell: (record) => record.providerId,
    },
    {
      id: "owner",
      header: t("columns.owner"),
      width: "sm",
      cell: (record) => record.ownerRef,
    },
    {
      id: "tags",
      header: t("columns.tags"),
      cell: (record) =>
        record.tags?.length ? (
          <span className="inline-flex flex-wrap items-center gap-2xs">
            {record.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </span>
        ) : (
          tShared("common.none")
        ),
    },
    {
      id: "updated",
      header: tShared("columns.updatedAt"),
      width: "md",
      cell: (record) => formatDateTime(record.updatedAt, locale),
    },
  ];
}

// ─── 子组件：详情抽屉 ──────────────────────────────────────────────────────────

function CapabilityDetailDrawer({
  capabilityId,
  onClose,
}: {
  capabilityId: string;
  onClose: () => void;
}) {
  const t = useTranslations("skillsPage");
  const tShared = useTranslations();
  const locale = useLocale();
  const [detail, setDetail] = useState<RunosCapabilityDetailRecord | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRunosCapability(capabilityId)
      .then((record) => {
        if (!cancelled) setDetail(record);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, t("detail.loadFailed")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [capabilityId, t]);

  const versionColumns = useMemo(
    (): readonly DataTableColumn<
      RunosCapabilityDetailRecord["versions"][number]
    >[] => [
      {
        id: "version",
        header: t("detail.versions.version"),
        cell: (v) => v.version,
      },
      {
        id: "state",
        header: t("detail.versions.state"),
        align: "center",
        width: "sm",
        cell: (v) => (
          <StatusBadge tone={VERSION_STATE_TONE[v.state] ?? "neutral"}>
            {v.state}
          </StatusBadge>
        ),
      },
      {
        id: "digest",
        header: t("detail.versions.digest"),
        cell: (v) => (
          <span title={v.contentDigest}>{v.contentDigest.slice(0, 12)}</span>
        ),
      },
      {
        id: "createdAt",
        header: t("detail.versions.createdAt"),
        width: "md",
        cell: (v) => formatDateTime(v.createdAt, locale),
      },
    ],
    [t, locale],
  );

  const endpointColumns = useMemo(
    (): readonly DataTableColumn<
      RunosCapabilityDetailRecord["endpoints"][number]
    >[] => [
      {
        id: "environment",
        header: t("detail.endpoints.environment"),
        width: "sm",
        cell: (e) => e.environment,
      },
      {
        id: "baseUrl",
        header: t("detail.endpoints.baseUrl"),
        cell: (e) => <span title={e.baseUrl}>{e.baseUrl}</span>,
      },
      {
        id: "version",
        header: t("detail.endpoints.version"),
        width: "sm",
        cell: (e) => e.version,
      },
      {
        id: "state",
        header: t("detail.endpoints.state"),
        align: "center",
        width: "sm",
        cell: (e) => (
          <StatusBadge tone={ENDPOINT_STATE_TONE[e.state] ?? "neutral"}>
            {e.state}
          </StatusBadge>
        ),
      },
    ],
    [t],
  );

  const title = detail ? displayNameFor(detail, locale) : t("detail.title");

  return (
    <Drawer open onClose={onClose} title={title} width="lg">
      {loading ? (
        <EmptyState
          title={t("detail.loading")}
          description={t("detail.loadingDescription")}
        />
      ) : error ? (
        <EmptyState title={t("detail.loadFailed")} description={error} />
      ) : detail ? (
        <div className="grid gap-5">
          <DetailList>
            <DetailRow label={t("detail.fields.capabilityId")}>
              {detail.capabilityId}
            </DetailRow>
            <DetailRow label={t("detail.fields.title")}>
              {detail.title}
            </DetailRow>
            {Object.entries(detail.displayName ?? {}).map(([lang, name]) => (
              <DetailRow
                key={lang}
                label={t("detail.fields.displayName", { locale: lang })}
              >
                {name}
              </DetailRow>
            ))}
            <DetailRow label={t("detail.fields.primitive")}>
              {labelFrom(t, "primitive", PRIMITIVE_TYPES, detail.primitiveType)}
            </DetailRow>
            <DetailRow label={t("detail.fields.category")}>
              {detail.category
                ? labelFrom(t, "category", CATEGORY_CODES, detail.category)
                : tShared("common.none")}
            </DetailRow>
            <DetailRow label={t("detail.fields.tier")}>
              <StatusBadge tone={TIER_TONE[detail.admissionTier] ?? "neutral"}>
                {labelFrom(t, "tier", ADMISSION_TIERS, detail.admissionTier)}
              </StatusBadge>
            </DetailRow>
            <DetailRow label={t("detail.fields.provider")}>
              {detail.providerId}
            </DetailRow>
            <DetailRow label={t("detail.fields.owner")}>
              {detail.ownerRef}
            </DetailRow>
            <DetailRow label={t("detail.fields.tags")}>
              {detail.tags?.length ? (
                <span className="inline-flex flex-wrap items-center gap-2xs">
                  {detail.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </span>
              ) : (
                tShared("common.none")
              )}
            </DetailRow>
            <DetailRow label={t("detail.fields.createdAt")}>
              {formatDateTime(detail.createdAt, locale)}
            </DetailRow>
            <DetailRow label={tShared("columns.updatedAt")}>
              {formatDateTime(detail.updatedAt, locale)}
            </DetailRow>
          </DetailList>

          <section className="grid gap-3">
            <DetailSectionHeading
              title={t("detail.versions.title")}
              titleSuffix={
                <Badge variant="secondary">
                  {t("detail.versions.count", {
                    count: detail.versions.length,
                  })}
                </Badge>
              }
            />
            <DataTable
              columns={versionColumns}
              rows={detail.versions}
              rowKey={(v) => `${v.capabilityId}@${v.version}`}
              empty={<EmptyState title={t("detail.versions.empty")} />}
            />
          </section>

          <section className="grid gap-3">
            <DetailSectionHeading title={t("detail.aliases.title")} />
            {detail.aliases.length ? (
              <DetailList>
                {detail.aliases.map((alias) => (
                  <DetailRow key={alias.alias} label={alias.alias}>
                    {alias.version}
                  </DetailRow>
                ))}
              </DetailList>
            ) : (
              <EmptyState title={t("detail.aliases.empty")} />
            )}
          </section>

          <section className="grid gap-3">
            <DetailSectionHeading
              title={t("detail.endpoints.title")}
              titleSuffix={
                <Badge variant="secondary">
                  {t("detail.endpoints.count", {
                    count: detail.endpoints.length,
                  })}
                </Badge>
              }
            />
            <DataTable
              columns={endpointColumns}
              rows={detail.endpoints}
              rowKey={(e) => e.id}
              empty={<EmptyState title={t("detail.endpoints.empty")} />}
            />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

// ─── 主组件 ───────────────────────────────────────────────────────────────────

export function SkillsPage() {
  const locale = useLocale();
  const t = useTranslations("skillsPage");
  const tShared = useTranslations();
  const [capabilities, setCapabilities] = useState<RunosCapabilityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<RunosManagementEntry | null>(null);
  const [search, setSearch] = useState("");
  const [primitiveFilter, setPrimitiveFilter] =
    useState<PrimitiveFilter>("all");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRunosCapabilities()
      .then((rows) => {
        if (!cancelled) setCapabilities(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, t("empty.loadFailedTitle")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    /* 链接拿不到就不渲染按钮：无权限、或 BFF 没配 OPERA_BASE_URL，都不该挡住目录本身。 */
    void fetchRunosManagementEntry().then((value) => {
      if (!cancelled) setEntry(value);
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const openDetail = useCallback((capabilityId: string) => {
    setDetailId(capabilityId);
  }, []);

  /* 钉在 t / locale / openDetail 上：工厂每次调用都新建数组，不 memo 等于每次渲染换一套列。 */
  const tableColumns = useMemo(
    () => capabilityColumns({ t, tShared, locale, onOpen: openDetail }),
    [t, tShared, locale, openDetail],
  );

  const categories = useMemo(
    () =>
      [
        ...new Set(
          capabilities
            .map((c) => c.category)
            .filter((c): c is string => Boolean(c)),
        ),
      ].sort(),
    [capabilities],
  );

  const filtered = useMemo(() => {
    let result = capabilities;
    if (primitiveFilter !== "all")
      result = result.filter((c) => c.primitiveType === primitiveFilter);
    if (tierFilter !== "all")
      result = result.filter((c) => c.admissionTier === tierFilter);
    if (categoryFilter)
      result = result.filter((c) => c.category === categoryFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((c) => capabilitySearchText(c).includes(q));
    }
    return result;
  }, [capabilities, search, primitiveFilter, tierFilter, categoryFilter]);

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const filtersActive =
    Boolean(search) ||
    primitiveFilter !== "all" ||
    tierFilter !== "all" ||
    Boolean(categoryFilter);

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };
  const handlePrimitiveFilter = (v: PrimitiveFilter) => {
    setPrimitiveFilter(v);
    setPage(1);
  };
  const handleTierFilter = (v: TierFilter) => {
    setTierFilter(v);
    setPage(1);
  };
  const handleCategoryFilter = (v: string) => {
    setCategoryFilter(v);
    setPage(1);
  };

  const manageInOpera = entry ? (
    <Button asChild variant="outline">
      <a href={entry.url} target="_blank" rel="noreferrer">
        <Icon name="external-link" size="xs" fallback="placeholder" />
        {t("header.manageInOpera")}
      </a>
    </Button>
  ) : null;

  return (
    <>
      <ListPageTemplate
        header={
          <PageHeader
            icon="cube"
            title={t("header.title")}
            description={t("header.description")}
            action={manageInOpera}
          />
        }
        summary={
          error ? (
            <Banner
              tone="danger"
              title={t("empty.loadFailedTitle")}
              description={t("empty.loadFailedDescription", {
                message: error,
              })}
            />
          ) : (
            <CapabilitySummary capabilities={capabilities} loading={loading} />
          )
        }
        filters={
          <CapabilityToolbar
            search={search}
            primitiveFilter={primitiveFilter}
            tierFilter={tierFilter}
            categoryFilter={categoryFilter}
            categories={categories}
            total={filtered.length}
            onSearchChange={handleSearch}
            onPrimitiveFilterChange={handlePrimitiveFilter}
            onTierFilterChange={handleTierFilter}
            onCategoryFilterChange={handleCategoryFilter}
          />
        }
        table={
          <DataTable
            columns={tableColumns}
            rows={pageRows}
            rowKey={(record) => record.capabilityId}
            loading={loading}
            indexStart={(page - 1) * PAGE_SIZE + 1}
            rowActions={(record) => (
              <ActionMenu
                label={t("actions.menu", {
                  name: displayNameFor(record, locale),
                })}
                items={[
                  {
                    id: "detail",
                    label: tShared("actions.viewDetail"),
                    icon: "eye",
                    onSelect: () => openDetail(record.capabilityId),
                  },
                ]}
              />
            )}
            empty={
              error ? (
                <EmptyState
                  title={t("empty.loadFailedTitle")}
                  description={error}
                />
              ) : filtersActive ? (
                <EmptyState
                  title={t("empty.filteredTitle")}
                  description={tShared("common.adjustFiltersHint")}
                />
              ) : (
                <EmptyState
                  title={t("empty.title")}
                  description={t("empty.description")}
                  action={manageInOpera ?? undefined}
                />
              )
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
        }
      />
      {detailId ? (
        <CapabilityDetailDrawer
          capabilityId={detailId}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </>
  );
}
