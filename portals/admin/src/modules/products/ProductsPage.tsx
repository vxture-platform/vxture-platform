"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTableLabels } from "@/modules/shared/table";
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
import type { DataTableColumn } from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import type { IconName } from "@vxture/design-system";
import { fetchProductCapabilities } from "@/api/admin-bff";
import type {
  ProductCapabilityIntegrationStatus,
  ProductCapabilityRecord,
  ProductCapabilitySource,
  ProductCapabilityStatus,
  ProductCapabilityType,
} from "@/entities/console";
import {
  ACCESS_STATUS_TONE,
  PUBLISH_STATUS_TONE,
} from "@/modules/shared/publish-tone";
import { PageHeader } from "@/modules/shared/PageHeader";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { formatNumber } from "@/modules/tenants/tenant-utils";

type TypeFilter = "all" | ProductCapabilityType;
type SourceFilter = "all" | ProductCapabilitySource;
type StatusFilter = "all" | ProductCapabilityStatus;
type AccessFilter = "all" | ProductCapabilityIntegrationStatus;

function productTypeLabel(type: ProductCapabilityType) {
  if (type === "platform") return "平台";
  if (type === "agent") return "智能体";
  if (type === "model") return "模型";
  if (type === "data") return "数据";
  return "服务";
}

function productSourceLabel(source: ProductCapabilitySource) {
  return source === "self" ? "自建" : "三方接入";
}

function productStatusLabel(status: ProductCapabilityStatus) {
  if (status === "active") return "已上线";
  if (status === "draft") return "草稿";
  return "已归档";
}

function productAccessLabel(state: ProductCapabilityIntegrationStatus) {
  if (state === "connected") return "已接入";
  if (state === "testing") return "联调中";
  if (state === "config_required") return "待配置";
  return "无需接入";
}

function productTypeIcon(type: ProductCapabilityType): IconName {
  if (type === "platform") return "database";
  if (type === "agent") return "agent";
  if (type === "model") return "cloud";
  if (type === "data") return "table";
  return "server";
}

function productSearchText(product: ProductCapabilityRecord) {
  return [
    product.productCode,
    product.productName,
    product.description,
    product.productType,
    product.source,
    product.status,
    product.productNameEn,
    product.categoryName,
    product.originProvider,
    product.meteringUnit,
    productAccessLabel(product.integration.status),
    ...product.tags,
    ...product.relatedSolutions.map(
      (solution) =>
        `${solution.solutionCode} ${solution.solutionName} ${solution.role}`,
    ),
    ...product.releases.map(
      (release) =>
        `${release.releaseCode} ${release.releaseName} ${release.versionLabels.join(" ")}`,
    ),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * 行操作。
 *
 * 原来四项里**三项是死的**（编辑能力 / 接入配置 / 上线下线，全部 disabled）。
 * 按 owner 定的两条原则重排（2026-09-21）：重复的功能做成跳转、不能是死的按钮。
 *
 *   编辑能力   → admin 能编的只有营销内容，换成「营销配置」跳独立页
 *   接入配置   → 接入是 opera 的 C1/C2/C3 清单，admin 没有写路径，删
 *   上线/下线  → `products.status` 的迁移归 opera（带 step-up + 上线门），
 *                在 admin 挂这颗按钮是越权表达，删
 *
 * 「关联方案」没进来：/product-solutions 没有按产品过滤的路由，跳过去只会落在
 * 未筛选的全表上；而产品详情页的「关联方案」段本来就列它，不重复建入口。
 *
 * 剩下的全是跳转，一个死按钮都没有。
 */
function ProductActionsMenu({
  product,
  onViewDetails,
  onOpenMarketing,
  onOpenPlans,
}: {
  product: ProductCapabilityRecord;
  onViewDetails: () => void;
  onOpenMarketing: () => void;
  onOpenPlans: () => void;
}) {
  const tShared = useTranslations();
  return (
    <div
      className="relative z-[1] inline-flex justify-self-end"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${product.productName} 操作`}
        items={[
          {
            id: "details",
            label: tShared("actions.viewDetail"),
            icon: "arrow-right",
            onSelect: onViewDetails,
          },
          {
            id: "marketing",
            label: "营销配置",
            icon: "edit",
            separatorBefore: true,
            onSelect: onOpenMarketing,
          },
          {
            id: "plans",
            label: "发布套餐",
            icon: "package",
            disabled: !product.planCount,
            ...(product.planCount ? {} : { hint: "该产品还没有套餐" }),
            onSelect: onOpenPlans,
          },
        ]}
      />
    </div>
  );
}

/**
 * 发布态、接入态走 `StatusBadge`；产品类型与供给来源是**类目**，一律中性
 * （`categoryTone`）——判据见 `publish-tone.ts` 文件头。
 */
function useProductColumns(
  onOpenDetails: (productCode: string) => void,
): DataTableColumn<ProductCapabilityRecord>[] {
  const tShared = useTranslations();
  return [
    {
      id: "product",
      header: "产品",
      cell: (product) => (
        <TableTitleCell
          icon={productTypeIcon(product.productType)}
          title={product.productName}
          /* 副题原来是 `产品代码 · 全球`，而「全球」来自 BFF 里一行硬编码的
             `region: "global"`（products 表根本没有这一列）——六行画同一个词。
             换成英文名：真数据、逐个不同、运营对外沟通用得上。 */
          description={`${product.productCode} · ${product.productNameEn || "—"}`}
          onTitleClick={() => onOpenDetails(product.productCode)}
        />
      ),
    },
    {
      id: "type",
      header: tShared("columns.kind"),
      align: "center",
      cell: (product) => (
        <span className="inline-flex flex-wrap justify-center gap-2xs">
          <Badge>{productTypeLabel(product.productType)}</Badge>
          <Badge>{productSourceLabel(product.source)}</Badge>
        </span>
      ),
    },
    {
      /* 「发布套餐」而不是「方案」（owner 2026-09-21）：这一格装的主数是套餐数，
         方案是它的上游。副题给**订阅开放**——该产品的套餐里有几个对外开放自助
         购买（plans.is_public，console 侧三处真在过滤它）。 */
      id: "plans",
      header: "发布套餐",
      align: "center",
      width: "sm",
      cell: (product) => (
        <TableTitleCell
          layout="stacked"
          title={`${formatNumber(product.planCount)} 套餐`}
          description={
            product.planCount
              ? `公开 ${formatNumber(product.publicPlanCount)} · 方案 ${formatNumber(product.solutionCount)}`
              : "—"
          }
        />
      ),
    },
    {
      id: "status",
      header: tShared("columns.state"),
      align: "center",
      width: "xs",
      cell: (product) => (
        <span className="inline-flex flex-col items-center gap-2xs">
          <StatusBadge tone={PUBLISH_STATUS_TONE[product.status]}>
            {productStatusLabel(product.status)}
          </StatusBadge>
          {/* 副题原来还并了一个 `健康/关注`，而 healthStatus 是由 status 派生的
              （active→normal，其余→warning）——同一件事说两遍。留可见性：那是
              另一根真轴，运营改得动。 */}
          <span className="text-body-sm text-muted-foreground">
            {product.visibility === "public" ? "客户端可见" : "仅运营端"}
          </span>
        </span>
      ),
    },
    {
      id: "access",
      header: "接入",
      align: "center",
      cell: (product) => (
        <span className="inline-flex flex-col items-center gap-2xs">
          {
            <StatusBadge tone={ACCESS_STATUS_TONE[product.integration.status]}>
              {productAccessLabel(product.integration.status)}
            </StatusBadge>
          }
          <span className="text-body-sm text-muted-foreground">{`${formatNumber(product.modelPolicyCount)} 模型授权`}</span>
        </span>
      ),
    },
    {
      /* 「计量配额」并显数量（owner 2026-09-21）。原来主题是单位、副题是
         `billingMode`——而后者在 BFF 里恒为空串，副题永远空着。 */
      id: "metering",
      header: "计量配额",
      align: "center",
      width: "xs",
      cell: (product) => (
        <TableTitleCell
          layout="stacked"
          title={`${formatNumber(product.metrics.length)} 项`}
          description={product.meteringUnit || "—"}
        />
      ),
    },
  ];
}

export function ProductsPage() {
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const router = useRouter();
  const [products, setProducts] = useState<ProductCapabilityRecord[]>([]);
  const [selectedProductCodes, setSelectedProductCodes] = useState<Set<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchProductCapabilities()
      .then((records) => {
        if (!active) return;
        setProducts(records);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const productColumns = useProductColumns(handleOpenDetails);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return products.filter((product) => {
      if (typeFilter !== "all" && product.productType !== typeFilter)
        return false;
      if (sourceFilter !== "all" && product.source !== sourceFilter)
        return false;
      if (statusFilter !== "all" && product.status !== statusFilter)
        return false;
      if (accessFilter !== "all" && product.integration.status !== accessFilter)
        return false;
      if (
        normalizedQuery &&
        !productSearchText(product).includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [accessFilter, products, query, sourceFilter, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const activePage = Math.min(currentPage, pageCount);
  const visibleProducts = filteredProducts.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const activeProducts = products.filter(
    (product) => product.status === "active",
  ).length;
  const agentProducts = products.filter(
    (product) => product.productType === "agent",
  ).length;
  const platformProducts = products.filter(
    (product) => product.productType === "platform",
  ).length;
  const partnerProducts = products.filter(
    (product) => product.source === "partner",
  ).length;
  /* 合作方家数：按 origin_provider 去重。一个合作方可以供多个产品（owner
     2026-09-21），所以产品数不等于合作方数——卡上两个数各说一件事。
     没填 provider 的三方产品不计入家数（库里 origin='third_party' 时它必填，
     这里的兜底只为防脏数据把空串数成一家）。 */
  const partnerCount = new Set(
    products
      .filter((product) => product.source === "partner")
      .map((product) => product.originProvider.trim())
      .filter(Boolean),
  ).size;
  const solutionCount = new Set(
    products.flatMap((product) =>
      product.relatedSolutions.map((solution) => solution.solutionCode),
    ),
  ).size;
  const configRequiredProducts = products.filter(
    (product) =>
      product.integration.status === "config_required" ||
      product.integration.status === "testing",
  ).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [accessFilter, pageSize, query, sourceFilter, statusFilter, typeFilter]);

  function handleReset() {
    setQuery("");
    setTypeFilter("all");
    setSourceFilter("all");
    setStatusFilter("all");
    setAccessFilter("all");
  }

  function handleOpenDetails(productCode: string) {
    router.push(`/products/${encodeURIComponent(productCode)}`);
  }

  return (
    <>
      <ListPageTemplate
        className="w-full vx-product-management-page"
        header={
          <PageHeader
            icon="database"
            title="产品目录"
            description="维护产品的成熟度、可见性与营销内容。技术接入在运维台。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="产品管理统计"
              items={[
                {
                  id: "total",
                  help: "产品总数。",
                  icon: "database",
                  label: "产品总数",
                  value: formatNumber(products.length),
                  tags: [`上线 ${formatNumber(activeProducts)}`],
                },
                {
                  id: "types",
                  help: "归属智能体与平台两类的产品数之和。",
                  icon: "agent",
                  label: "产品类型",
                  value: formatNumber(agentProducts + platformProducts),
                  tags: [
                    `智能体 ${formatNumber(agentProducts)}`,
                    `平台 ${formatNumber(platformProducts)}`,
                  ],
                  tone: "success",
                },
                {
                  id: "partner",
                  /* 读数是**产品数**，标是**合作方数**——一个合作方可以供多个
                      产品（owner 2026-09-21）。原来标是个光秃秃的「合作方」，
                      不带数，读者无从知道这 N 个产品来自几家。 */
                  help: "来源为三方接入的产品数；标内是去重后的合作方家数。",
                  icon: "cloud",
                  label: "三方接入",
                  value: formatNumber(partnerProducts),
                  tags: [`${formatNumber(partnerCount)} 合作方`],
                  tone: partnerProducts ? "warning" : "success",
                },
                {
                  id: "solutions",
                  help: "这些产品被引用到的业务方案数，按方案编码去重。",
                  icon: "workflow",
                  label: "方案复用",
                  value: formatNumber(solutionCount),
                  tags: [`待配置 ${formatNumber(configRequiredProducts)}`],
                  tone: configRequiredProducts ? "warning" : "brand",
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
            count={formatNumber(filteredProducts.length)}
            aria-label="产品筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索能力、code、方案、计量"
                className="min-w-media-2xl grow basis-0 max-w-panel-sm"
                aria-label="搜索产品"
              />
            }
            onReset={handleReset}
            actions={
              <>
                <ActionButton variant="outline" icon="plus" disabled>
                  新建能力
                </ActionButton>
              </>
            }
          >
            <>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as TypeFilter)
                }
                aria-label="能力类型"
              >
                <option value="all">{tShared("filters.allKinds")}</option>
                <option value="platform">平台</option>
                <option value="agent">智能体</option>
                <option value="model">模型</option>
                <option value="data">数据</option>
                <option value="service">服务</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(event.target.value as SourceFilter)
                }
                aria-label="产品来源"
              >
                <option value="all">全部来源</option>
                <option value="self">自建</option>
                <option value="partner">三方接入</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="产品状态"
              >
                <option value="all">{tShared("filters.allStates")}</option>
                <option value="active">已上线</option>
                <option value="draft">{tShared("status.generic.draft")}</option>
                <option value="archived">已归档</option>
              </NativeSelect>
              <NativeSelect
                wrapperClassName="w-fit basis-media-xl"
                value={accessFilter}
                onChange={(event) =>
                  setAccessFilter(event.target.value as AccessFilter)
                }
                aria-label="接入状态"
              >
                <option value="all">全部接入</option>
                <option value="connected">已接入</option>
                <option value="testing">联调中</option>
                <option value="config_required">待配置</option>
                <option value="not_required">无需接入</option>
              </NativeSelect>
            </>
          </FilterBar>
        }
        table={
          <section
            className="grid min-w-0 max-w-full gap-xs"
            aria-label="产品清单"
          >
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}

            <DataTable
              labels={tableLabels}
              columns={productColumns}
              rows={visibleProducts}
              rowKey={(product) => product.productCode}
              loading={loading}
              indexStart={(activePage - 1) * pageSize + 1}
              selectedKeys={[...selectedProductCodes]}
              onSelectionChange={(keys) =>
                setSelectedProductCodes(new Set(keys))
              }
              rowActions={(product) => (
                <ProductActionsMenu
                  product={product}
                  onViewDetails={() => handleOpenDetails(product.productCode)}
                  /* 营销配置是**与产品详情同级**的独立二级页，不是它的子页——
                     两者互为跳转，不是隶属（owner 2026-09-21）。 */
                  onOpenMarketing={() =>
                    router.push(
                      `/products/${encodeURIComponent(product.productCode)}/marketing`,
                    )
                  }
                  onOpenPlans={() =>
                    router.push(
                      `/plan-versions/${encodeURIComponent(product.productCode)}`,
                    )
                  }
                />
              )}
              empty={
                <EmptyState
                  title="没有匹配的产品"
                  description="清空筛选条件后可查看全部产品。"
                  action={
                    <ActionButton
                      variant="outline"
                      icon="x"
                      onClick={handleReset}
                    >
                      {tShared("common.clearFilters")}
                    </ActionButton>
                  }
                />
              }
            />
          </section>
        }
        footer={
          <ListPagination
            currentPage={activePage}
            pageCount={pageCount}
            total={filteredProducts.length}
            pageSize={pageSize}
            onPageSizeChange={setPageSize}
            onPageChange={(page) =>
              setCurrentPage(Math.min(Math.max(page, 1), pageCount))
            }
          />
        }
      />
    </>
  );
}
