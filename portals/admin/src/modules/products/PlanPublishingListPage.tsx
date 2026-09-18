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
 * ── 已退役默认收起 ────────────────────────────────────────────────────────
 * 退役不是删除：老订阅仍钉在它的版本上照常解析，所以行还在、查得到，只是退出主视线。
 * 收起由服务端的 `?include=deprecated` 开关承担，不在前端过滤——前端过滤会让统计卡
 * 的分母与表格内容各说各话。
 *
 * @author AI-Generated
 * @date 2026-09-18
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ListPageTemplate,
  MetricGrid,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import { fetchPlanMatrix, type PlanMatrixProduct } from "@/api/admin-bff";
import { PageHeader } from "@/modules/shared/PageHeader";
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
  planCount: number;
  versionCount: number;
  subscriptionCount: number;
  /** 该产品名下是否**全部**套餐都已退役——整行据此标「已退役」。 */
  allDeprecated: boolean;
}

function toRow(product: PlanMatrixProduct): ProductRow {
  const liveTiers: string[] = [];
  const draftTiers: string[] = [];
  for (const plan of product.plans) {
    if (plan.currentVersion) {
      liveTiers.push(plan.tier);
    } else if (plan.draftVersion) {
      draftTiers.push(plan.tier);
    }
  }
  return {
    productCode: product.productCode,
    productName: product.productName,
    productStatus: product.productStatus,
    liveTiers,
    draftTiers,
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

export function PlanPublishingListPage() {
  const t = useTranslations("planVersionsPage");
  const router = useRouter();
  const tableLabels = useTableLabels();

  const [products, setProducts] = useState<PlanMatrixProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  const load = useCallback(async (includeDeprecated: boolean) => {
    setLoading(true);
    try {
      const data = await fetchPlanMatrix(includeDeprecated);
      setProducts(data);
      // `fetchPlanMatrix` 读失败时回落空数组而不是抛，所以「空」有两种可能：
      // 真的没有可独立订阅的产品，或者请求挂了。这里不把两者混成同一句话——
      // 空数组时标记一次，让空态文案能分开说。
      setLoadFailed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(showRetired);
  }, [load, showRetired]);

  const rows = useMemo(() => products.map(toRow), [products]);

  // 四张统计卡：全部从同一份 rows 派生，与表格内容同源，不会各说各话。
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

  const openDetail = useCallback(
    (productCode: string) => {
      router.push(`/plan-versions/${encodeURIComponent(productCode)}`);
    },
    [router],
  );

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
                {tierLabel(tier)}
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

  return (
    <ListPageTemplate
      className="w-full"
      header={
        <PageHeader
          icon="table"
          title={t("title")}
          description={t("pageDescription")}
          action={
            <Button
              variant={showRetired ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowRetired((on) => !on)}
            >
              {t("list.showRetired")}
            </Button>
          }
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
      table={
        <DataTable
          labels={tableLabels}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.productCode}
          loading={loading}
          rowActions={(row) => (
            <Button
              variant={row.planCount === 0 ? "secondary" : "outline"}
              size="sm"
              onClick={() => openDetail(row.productCode)}
            >
              {row.planCount === 0 ? t("list.configure") : t("list.enter")}
            </Button>
          )}
          empty={
            <EmptyState
              title={loadFailed ? t("list.loadFailed") : t("list.empty")}
              description={loadFailed ? undefined : t("lifecycle.note")}
            />
          }
        />
      }
    />
  );
}
