"use client";

/**
 * PlanPublishingListPage.tsx —— 套餐发布的一级列表（每行一个产品）。
 *
 * @package  @vxture/admin
 * @layer    Presentation
 * @category module
 *
 * ── 为什么不再是「产品 × 五档」的矩阵 ──────────────────────────────────────
 * 旧版把每个产品画成五个格子，没发布的档就是一个待填的空格——于是一个只卖两档的
 * 产品看起来永远缺三档。但档位是**按需挂的**：`plan_components.tier` 可空，唯一键
 * 用 `NULLS NOT DISTINCT`，五档是**值域上限**不是填充要求。所以这一屏改成每行一个
 * 产品，「在售档位」只显示**实际挂了的** chip；没挂的不占位、也不催人填。
 *
 * ── 四张统计卡的分母 ──────────────────────────────────────────────────────
 * 数据源 `PLAN_MATRIX_SQL` 外层写着 `pr.deleted_at IS NULL AND pr.standalone_subscribable`
 * ——**只有可独立订阅的产品才进来**。所以四个数字的分母都是「可独立订阅的产品」，
 * 不是目录里的全部产品；捆绑型组件产品没有自己的售卖档位，不在此列。这一点写进了
 * 每张卡的 `help`，否则运营会拿它跟产品目录的总数对，然后对不上。
 *
 * ── 表格按平台通例成套接 ──────────────────────────────────────────────────
 * 选择列 + 序号列 + 居右的行操作菜单 + `FilterBar` 工具栏 + `ListPagination` 页脚，
 * 与 `/products`、`/accounts` 同一套，不另立结构。行动作一律进 `ActionMenu`，
 * 不外放按钮。
 *
 * ── 已退役默认收起 ────────────────────────────────────────────────────────
 * 退役不是删除：老订阅仍钉在它的版本上照常解析，所以行还在、查得到，只是退出主视线。
 * 收起由服务端的 `?include=deprecated` 开关承担，不在前端过滤——前端过滤会让统计卡
 * 的分母与表格内容各说各话。它是个筛选条件，所以入口放在 `FilterBar` 里而不是页头。
 *
 * @author AI-Generated
 * @date 2026-09-18
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  ActionButton,
  ActionMenu,
  Badge,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type {
  ActionMenuItem,
  DataTableColumn,
  StatusBadgeTone,
} from "@vxture/design-system";
import { fetchPlanMatrix, type PlanMatrixProduct } from "@/api/admin-bff";
import { ListPagination } from "@/modules/shared/ListPagination";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { useTableLabels } from "@/modules/shared/table";
import { tierBadgeClass, tierLabel } from "@/modules/shared/tier-level";
import { formatNumber } from "@/modules/tenants/tenant-utils";

/** 一行的派生态：全部从矩阵数据算出，不新增接口。 */
interface ProductRow {
  productCode: string;
  productName: string;
  productStatus: string;
  /** 已发布（有当前版本）的档位，按 plans 顺序。 */
  liveTiers: string[];
  /** 只有在途草稿、尚未发布的档位。 */
  draftTiers: string[];
  /** 同一档挂了多于一条套餐的档位——库里允许，界面必须标出来。 */
  crowdedTiers: Set<string>;
  planCount: number;
  versionCount: number;
  subscriptionCount: number;
  /** 该产品名下是否**全部**套餐都已退役——整行据此标「已退役」。 */
  allDeprecated: boolean;
}

function toRow(product: PlanMatrixProduct): ProductRow {
  // 按档位聚合，不按套餐逐个渲：库里**不禁止同档多套餐**（arda 的 pro 档挂着两条），
  // 逐个渲会让同一档出现两枚同名 chip，看起来像多出一个档位——那正是初版让人数出
  // 「6 个档位」的原因。同档多于一条时只出一枚 chip，并在 crowdedTiers 里标出来。
  const live = new Set<string>();
  const draft = new Set<string>();
  const perTier = new Map<string, number>();
  for (const plan of product.plans) {
    perTier.set(plan.tier, (perTier.get(plan.tier) ?? 0) + 1);
    if (plan.currentVersion) {
      live.add(plan.tier);
    } else if (plan.draftVersion) {
      draft.add(plan.tier);
    }
  }
  const liveTiers = [...live];
  // 只有草稿、且该档没有在售版本的，才算「草稿档」——否则同一档会既是在售又是草稿。
  const draftTiers = [...draft].filter((tier) => !live.has(tier));
  const crowdedTiers = new Set(
    [...perTier.entries()].filter(([, n]) => n > 1).map(([tier]) => tier),
  );
  return {
    productCode: product.productCode,
    productName: product.productName,
    productStatus: product.productStatus,
    liveTiers,
    draftTiers,
    crowdedTiers,
    planCount: product.plans.length,
    versionCount: product.plans.reduce((sum, p) => sum + p.versionCount, 0),
    subscriptionCount: product.plans.reduce(
      (sum, p) => sum + p.subscriptionCount,
      0,
    ),
    allDeprecated:
      product.plans.length > 0 &&
      product.plans.every((p) => p.planStatus === "deprecated"),
  };
}

type RowStatus = "published" | "draft" | "none" | "retired";

function rowStatus(row: ProductRow): RowStatus {
  if (row.allDeprecated) return "retired";
  if (row.liveTiers.length > 0) return "published";
  if (row.draftTiers.length > 0) return "draft";
  return "none";
}

const ROW_STATUS_TONE: Record<RowStatus, StatusBadgeTone> = {
  published: "success",
  draft: "warning",
  none: "neutral",
  retired: "neutral",
};

type StatusFilter = "all" | RowStatus;

export function PlanPublishingListPage() {
  const t = useTranslations("planVersionsPage");
  const tShared = useTranslations();
  const router = useRouter();
  const tableLabels = useTableLabels();

  const [products, setProducts] = useState<PlanMatrixProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRetired, setShowRetired] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(
    () => new Set(),
  );

  const load = useCallback(async (includeDeprecated: boolean) => {
    setLoading(true);
    try {
      setProducts(await fetchPlanMatrix(includeDeprecated));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(showRetired);
  }, [load, showRetired]);

  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, query, statusFilter, showRetired]);

  const rows = useMemo(() => products.map(toRow), [products]);

  // 四张统计卡：从**未经筛选**的全量派生——它们是这一屏的总体态势，
  // 跟着搜索框变会让人以为平台上只剩这几个产品。
  const stats = useMemo(() => {
    let sellingProducts = 0;
    let sellingVersions = 0;
    let drafts = 0;
    let unconfigured = 0;
    for (const row of rows) {
      if (row.liveTiers.length > 0) sellingProducts += 1;
      sellingVersions += row.liveTiers.length;
      drafts += row.draftTiers.length;
      if (row.planCount === 0) unconfigured += 1;
    }
    return { sellingProducts, sellingVersions, drafts, unconfigured };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && rowStatus(row) !== statusFilter)
        return false;
      if (
        needle &&
        !`${row.productName} ${row.productCode}`.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [rows, query, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleRows = filteredRows.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );

  const openDetail = useCallback(
    (productCode: string) => {
      router.push(`/plan-versions/${encodeURIComponent(productCode)}`);
    },
    [router],
  );

  const handleReset = useCallback(() => {
    setQuery("");
    setStatusFilter("all");
    setShowRetired(false);
  }, []);

  const columns: DataTableColumn<ProductRow>[] = [
    {
      id: "product",
      header: t("list.product"),
      cell: (row) => (
        <TableTitleCell
          icon="cube"
          title={row.productName}
          description={row.productCode}
          onTitleClick={() => openDetail(row.productCode)}
        />
      ),
    },
    {
      id: "tiers",
      header: t("list.sellingTiers"),
      cell: (row) =>
        row.liveTiers.length === 0 && row.draftTiers.length === 0 ? (
          <span className="text-body-sm text-muted-foreground">
            {t("list.noTier")}
          </span>
        ) : (
          <span className="inline-flex flex-wrap gap-2xs">
            {row.liveTiers.map((tier) => (
              <Badge
                key={`live-${tier}`}
                variant="outline"
                className={tierBadgeClass(tier)}
              >
                {row.crowdedTiers.has(tier)
                  ? `${tierLabel(tier)} · ${t("detail.crowded")}`
                  : tierLabel(tier)}
              </Badge>
            ))}
            {row.draftTiers.map((tier) => (
              <Badge key={`draft-${tier}`} variant="outline">
                {t("list.tierDrafting", { tier: tierLabel(tier) })}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      id: "plans",
      header: t("list.plans"),
      align: "center",
      cell: (row) => formatNumber(row.planCount),
    },
    {
      id: "versions",
      header: t("list.versions"),
      align: "center",
      cell: (row) => formatNumber(row.versionCount),
    },
    {
      id: "subscriptions",
      header: t("list.subscriptions"),
      align: "center",
      // 「在订阅」是这张表最要紧的一列：为 0 的产品改起来没有后顾之忧，非 0 的
      // 一动就牵扯正在付钱的人。0 显示为 0 而不是「—」——读不到才是「—」。
      cell: (row) => formatNumber(row.subscriptionCount),
    },
    {
      id: "status",
      header: t("list.status"),
      align: "center",
      cell: (row) => {
        const status = rowStatus(row);
        return (
          <StatusBadge tone={ROW_STATUS_TONE[status]}>
            {t(
              status === "published"
                ? "list.statusPublished"
                : status === "draft"
                  ? "list.statusDraft"
                  : status === "retired"
                    ? "list.statusRetired"
                    : "list.statusNone",
            )}
          </StatusBadge>
        );
      },
    },
  ];

  const rowMenuItems = (row: ProductRow): ActionMenuItem[] => [
    {
      id: "open",
      // 箭头只表达「往那边走」，与「查阅这个产品卖哪几档」无关；清单图标才贴语义。
      label: row.planCount === 0 ? t("list.configure") : t("list.viewPlans"),
      icon: "list-checks",
      onSelect: () => openDetail(row.productCode),
    },
  ];

  return (
    <ListPageTemplate
      className="w-full"
      header={
        <PageHeader
          icon="table"
          title={t("title")}
          description={t("pageDescription")}
        />
      }
      summary={
        <MetricGrid
          loading={loading}
          aria-label={t("title")}
          items={[
            {
              id: "selling-products",
              icon: "cube",
              label: t("stats.sellingProducts"),
              value: formatNumber(stats.sellingProducts),
              help: t("stats.sellingProductsHelp"),
              tone: "success",
            },
            {
              id: "selling-versions",
              icon: "check",
              label: t("stats.sellingVersions"),
              value: formatNumber(stats.sellingVersions),
              help: t("stats.sellingVersionsHelp"),
              tone: "brand",
            },
            {
              id: "drafts",
              icon: "clock",
              label: t("stats.drafts"),
              value: formatNumber(stats.drafts),
              help: t("stats.draftsHelp"),
              tone: stats.drafts > 0 ? "warning" : "neutral",
            },
            {
              id: "unconfigured",
              icon: "warning",
              label: t("stats.unconfigured"),
              value: formatNumber(stats.unconfigured),
              help: t("stats.unconfiguredHelp"),
              tone: stats.unconfigured > 0 ? "warning" : "neutral",
            },
          ]}
        />
      }
      filters={
        <FilterBar
          view="list"
          onViewChange={() => {}}
          cardsDisabledReason={tShared("common.cardsRetired")}
          count={formatNumber(filteredRows.length)}
          aria-label={t("detail.filterLabel")}
          search={
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("list.product")}
              className="min-w-media-2xl grow basis-0 max-w-panel-sm"
              aria-label={t("list.product")}
            />
          }
          onReset={handleReset}
        >
          <>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              aria-label={t("list.status")}
            >
              <option value="all">{t("list.status")}</option>
              <option value="published">{t("list.statusPublished")}</option>
              <option value="draft">{t("list.statusDraft")}</option>
              <option value="none">{t("list.statusNone")}</option>
              <option value="retired">{t("list.statusRetired")}</option>
            </NativeSelect>
            {/* 已退役是筛选条件，不是页面动作，所以入口在这里。 */}
            <ActionButton
              variant="outline"
              icon={showRetired ? "check" : "stop"}
              onClick={() => setShowRetired((on) => !on)}
            >
              {t("list.showRetired")}
            </ActionButton>
          </>
        </FilterBar>
      }
      table={
        <DataTable
          labels={tableLabels}
          columns={columns}
          rows={visibleRows}
          rowKey={(row) => row.productCode}
          loading={loading}
          indexStart={(activePage - 1) * pageSize + 1}
          selectedKeys={[...selectedCodes]}
          onSelectionChange={(keys) => setSelectedCodes(new Set(keys))}
          rowActions={(row) => (
            <div
              className="relative z-[1] inline-flex justify-self-end"
              onClick={(event) => event.stopPropagation()}
            >
              <ActionMenu
                label={t("detail.menuLabel", { name: row.productName })}
                items={rowMenuItems(row)}
              />
            </div>
          )}
          empty={
            <EmptyState
              title={t("list.empty")}
              description={t("lifecycle.note")}
              action={
                <ActionButton
                  variant="outline"
                  icon="refresh"
                  onClick={handleReset}
                >
                  {tShared("common.clearFilters")}
                </ActionButton>
              }
            />
          }
        />
      }
      footer={
        <ListPagination
          currentPage={activePage}
          pageCount={pageCount}
          total={filteredRows.length}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
        />
      }
    />
  );
}
