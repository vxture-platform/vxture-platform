"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { formatNumber, joinClasses } from "@/modules/tenants/tenant-utils";

type ViewMode = "list" | "cards";
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

function productRegionLabel(region: ProductCapabilityRecord["region"]) {
  if (region === "domestic") return "国内";
  if (region === "international") return "国际";
  return "全局";
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
    product.region,
    product.ownerTeam,
    product.meteringUnit,
    product.billingMode,
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

function ProductActionsMenu({
  product,
  onViewDetails,
}: {
  product: ProductCapabilityRecord;
  onViewDetails: () => void;
}) {
  return (
    <div
      className="vx-tenant-actions"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu
        label={`${product.productName} 操作`}
        items={[
          {
            id: "details",
            label: "查看详情",
            icon: "arrow-right",
            onSelect: onViewDetails,
          },
          {
            id: "edit",
            label: "编辑能力",
            icon: "edit",
            disabled: true,
          },
          {
            id: "integration",
            label: "接入配置",
            icon: "shield-check",
            disabled: true,
          },
          {
            id: "toggle-status",
            label: product.status === "active" ? "下线能力" : "上线能力",
            icon: product.status === "active" ? "x" : "check",
            disabled: true,
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
  return [
    {
      id: "product",
      header: "产品能力",
      cell: (product) => (
        <TableTitleCell
          icon={productTypeIcon(product.productType)}
          title={product.productName}
          description={`${product.productCode} · ${productRegionLabel(product.region)}`}
          onTitleClick={() => onOpenDetails(product.productCode)}
        />
      ),
    },
    {
      id: "type",
      header: "类型",
      align: "center",
      cell: (product) => (
        <span className="inline-flex flex-wrap justify-center gap-2xs">
          <Badge>{productTypeLabel(product.productType)}</Badge>
          <Badge>{productSourceLabel(product.source)}</Badge>
        </span>
      ),
    },
    {
      id: "status",
      header: "状态",
      align: "center",
      cell: (product) => (
        <TableTitleCell
          title={
            <StatusBadge tone={PUBLISH_STATUS_TONE[product.status]}>
              {productStatusLabel(product.status)}
            </StatusBadge>
          }
          description={`${product.visibility === "public" ? "公开" : "内部"} | ${
            product.healthStatus === "normal" ? "健康" : "关注"
          }`}
        />
      ),
    },
    {
      id: "supply",
      header: "方案",
      align: "center",
      cell: (product) => (
        <TableTitleCell
          title={`${formatNumber(product.solutionCount)} 方案`}
          description={`${formatNumber(product.planCount)} 套餐 | ${formatNumber(product.releaseCount)} 发布`}
        />
      ),
    },
    {
      id: "access",
      header: "接入",
      align: "center",
      cell: (product) => (
        <TableTitleCell
          title={
            <StatusBadge tone={ACCESS_STATUS_TONE[product.integration.status]}>
              {productAccessLabel(product.integration.status)}
            </StatusBadge>
          }
          description={`${formatNumber(product.modelPolicyCount)} 模型授权`}
        />
      ),
    },
    {
      id: "metering",
      header: "计量",
      align: "center",
      cell: (product) => (
        <TableTitleCell
          title={product.meteringUnit}
          description={product.billingMode}
        />
      ),
    },
  ];
}

function ProductCards({
  products,
  onOpenDetails,
}: {
  products: ProductCapabilityRecord[];
  onOpenDetails: (productCode: string) => void;
}) {
  return (
    <div
      className="vx-tenant-directory-cards vx-product-cards"
      aria-label="产品能力卡片"
    >
      {products.map((product) => (
        <article
          key={product.productCode}
          className={joinClasses(
            "vx-tenant-directory-card",
            `vx-product-card--${product.status}`,
          )}
          role="button"
          tabIndex={0}
          onClick={() => onOpenDetails(product.productCode)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onOpenDetails(product.productCode);
          }}
        >
          <header>
            <Icon
              name={productTypeIcon(product.productType)}
              size="lg"
              fallback="placeholder"
            />
            <div>
              <strong>{product.productName}</strong>
              <span>
                {product.productCode} · {productRegionLabel(product.region)}
              </span>
            </div>
            <ProductActionsMenu
              product={product}
              onViewDetails={() => onOpenDetails(product.productCode)}
            />
          </header>
          <div className="vx-tenant-directory-card__badges">
            <Badge>{productTypeLabel(product.productType)}</Badge>
            <Badge>{productSourceLabel(product.source)}</Badge>
            <StatusBadge tone={PUBLISH_STATUS_TONE[product.status]}>
              {productStatusLabel(product.status)}
            </StatusBadge>
          </div>
          <div className="vx-tenant-directory-card__metrics">
            <span>
              <b>{formatNumber(product.solutionCount)}</b>
              <small>方案</small>
            </span>
            <span>
              <b>{formatNumber(product.planCount)}</b>
              <small>套餐</small>
            </span>
            <span>
              <b>{formatNumber(product.modelPolicyCount)}</b>
              <small>策略</small>
            </span>
          </div>
          <footer>
            <span>{product.meteringUnit}</span>
            <strong>{productAccessLabel(product.integration.status)}</strong>
          </footer>
        </article>
      ))}
    </div>
  );
}

export function ProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductCapabilityRecord[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
  }, [
    accessFilter,
    pageSize,
    query,
    sourceFilter,
    statusFilter,
    typeFilter,
    viewMode,
  ]);

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
        className="vx-tenant-management-page vx-product-management-page"
        header={
          <PageHeader
            icon="database"
            title="产品能力"
            description="统一管理可组合、可授权、可计量的基础产品能力，作为解决方案、服务套餐和模型授权的供给目录。"
          />
        }
        summary={
          <>
            {" "}
            <MetricGrid
              loading={loading}
              aria-label="产品能力管理统计"
              items={[
                {
                  id: "total",
                  help: "产品能力总数。",
                  icon: "database",
                  label: "能力总数",
                  value: formatNumber(products.length),
                  tags: [`上线 ${formatNumber(activeProducts)}`],
                },
                {
                  id: "types",
                  help: "归属 agent 与 platform 两类的能力数之和。",
                  icon: "agent",
                  label: "能力类型",
                  value: formatNumber(agentProducts + platformProducts),
                  tags: [
                    `智能体 ${formatNumber(agentProducts)}`,
                    `平台 ${formatNumber(platformProducts)}`,
                  ],
                  tone: "success",
                },
                {
                  id: "partner",
                  help: "来源为三方接入的能力数。",
                  icon: "cloud",
                  label: "三方接入",
                  value: formatNumber(partnerProducts),
                  tags: ["合作方"],
                  tone: partnerProducts ? "warning" : "success",
                },
                {
                  id: "solutions",
                  help: "这些能力被引用到的业务方案数，按方案编码去重。",
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
            view={viewMode}
            onViewChange={setViewMode}
            cardsDisabledReason="卡片视图已停用：列表视图提供选择、排序、分页与跨页批量，运营台的清单是拿来扫读和对比的。"
            count={formatNumber(filteredProducts.length)}
            aria-label="产品能力筛选"
            search={
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索能力、code、方案、计量"
                className="vx-tenant-search vx-product-search"
                aria-label="搜索产品能力"
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
            <div className="vx-tenant-filters">
              <NativeSelect
                className="vx-input vx-tenant-select"
                value={typeFilter}
                onChange={(event) =>
                  setTypeFilter(event.target.value as TypeFilter)
                }
                aria-label="能力类型"
              >
                <option value="all">全部类型</option>
                <option value="platform">平台</option>
                <option value="agent">智能体</option>
                <option value="model">模型</option>
                <option value="data">数据</option>
                <option value="service">服务</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
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
                className="vx-input vx-tenant-select"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as StatusFilter)
                }
                aria-label="产品状态"
              >
                <option value="all">全部状态</option>
                <option value="active">已上线</option>
                <option value="draft">草稿</option>
                <option value="archived">已归档</option>
              </NativeSelect>
              <NativeSelect
                className="vx-input vx-tenant-select"
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
            </div>
          </FilterBar>
        }
        table={
          <section className="vx-tenant-directory" aria-label="产品能力清单">
            {/* 列表态的加载由 DataTable 出骨架行，卡片态没有骨架，仍留这行提示。 */}
            {loading && viewMode === "cards" ? (
              <header className="vx-tenant-directory__header">
                <span>读取中</span>
              </header>
            ) : null}

            {viewMode === "list" ? (
              <DataTable
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
                  />
                )}
                empty={
                  <EmptyState
                    title="没有匹配的产品能力"
                    description="清空筛选条件后可查看全部产品能力。"
                    action={
                      <ActionButton
                        variant="outline"
                        icon="x"
                        onClick={handleReset}
                      >
                        清空筛选
                      </ActionButton>
                    }
                  />
                }
              />
            ) : visibleProducts.length ? (
              <ProductCards
                products={visibleProducts}
                onOpenDetails={handleOpenDetails}
              />
            ) : (
              <section className="vx-tenant-empty">
                <EmptyState
                  title={loading ? "正在加载产品能力" : "没有匹配的产品能力"}
                  description={
                    loading
                      ? "正在读取产品能力供给目录。"
                      : "清空筛选条件后可查看全部产品能力。"
                  }
                  action={
                    <ActionButton
                      variant="outline"
                      icon="x"
                      onClick={handleReset}
                    >
                      清空筛选
                    </ActionButton>
                  }
                />
              </section>
            )}
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
