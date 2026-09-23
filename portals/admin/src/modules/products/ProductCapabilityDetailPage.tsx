"use client";

/**
 * ProductCapabilityDetailPage.tsx - 产品详情。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Products
 *
 * 版面按 owner 2026-09-21 重排：面包屑 + **一个**标题行（标题后跟一排状态标）
 * + 四段（基础资料 / 关联方案 / 计量配置 / 套餐版本）。
 *
 * ── 为什么只剩一个标题行 ──
 * 原来这一页有两个：`PageHeader`（标题 + 描述 + 返回/编辑按钮）叠着
 * `DetailSummaryHeader`（同一个标题 + 副标 + 徽章 + 四张 MetricGrid 卡）。
 * 同一个产品名连画两遍，四张卡还各占一格高。owner：「两个标题行重复，删一个；
 * 四个 card 收缩为 tag-status 跟在标题后面，不要太浪费空间。」
 *
 * ── 标题后那排标是哪来的 ──
 * 产品类型 / 产品来源 / 上线状态 / 接入状态 / 正式套餐数 / 计量项数。
 * owner 原列的是「可用状态」，但 `healthStatus` 在 BFF 里**就是由 status 派生**
 * （active→normal，其余→warning），两枚标永远一致、等于把同一件事说两遍。
 * 换成**接入状态**：那是真独立的信号（opera 的 C1/C2/C3 接入进度）。
 *
 * ── 「发布历史」为什么变成「套餐版本」 ──
 * 产品级发布历史**库里没有这个概念**：products 只有一个当前 release_version，
 * 没有历史表，而 BFF 里那个 `releases` 是恒空的壳（已删）。真有历史的是
 * `product.plan_versions`。owner 2026-09-21 认了这个改法。
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  DataTable,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  EmptyState,
  Icon,
  Section,
  StatusBadge,
  TableTitleCell,
  type DataTableColumn,
  type IconName,
} from "@vxture/design-system";
import { isValidReleaseStage } from "@vxture/core-utils";
import { orUnset } from "@/modules/shared/display";
import { fetchProductCapability } from "@/api/admin-bff";
import type {
  ProductCapabilityIntegrationStatus,
  ProductCapabilityRecord,
  ProductPlanVersionRecord,
  ProductCapabilitySource,
  ProductCapabilityStatus,
  ProductCapabilityType,
} from "@/entities/console";
import { PUBLISH_STATUS_TONE } from "@/modules/shared/publish-tone";
import {
  useCapabilityTypeLabels,
  useMergeStrategyLabels,
  useProductLayerLabels,
} from "@/modules/shared/enum-labels";
import { useTableLabels } from "@/modules/shared/table";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";

function capabilityTypeIcon(type: ProductCapabilityType): IconName {
  if (type === "platform") return "database";
  if (type === "agent") return "agent";
  if (type === "model") return "cloud";
  if (type === "data") return "table";
  return "server";
}

function sourceLabel(source: ProductCapabilitySource) {
  return source === "self" ? "自建" : "三方接入";
}

function statusLabel(status: ProductCapabilityStatus) {
  if (status === "active") return "已上线";
  if (status === "draft") return "草稿";
  return "已归档";
}

function integrationStatusLabel(status: ProductCapabilityIntegrationStatus) {
  if (status === "connected") return "已接入";
  if (status === "testing") return "联调中";
  if (status === "config_required") return "待配置";
  return "无需接入";
}

/*
 * 三组文案留在本页而不是进 `enum-labels`：那个模块**只收值域已在 @shared 成文的
 * 枚举**（规矩见它的头注）。成熟度 / 重置周期 / 终端支持三者的值域目前只在 DDL 的
 * CHECK 里，shared 没有契约——先立契约再谈展示映射，不能让展示层先于契约定义业务
 * 词汇。配额策略与产品分层有契约（MERGE_STRATEGIES / PRODUCT_LAYERS），已收进去。
 *
 * 认不得的值原样回显那个码，不编一个「其他」——没登记正是要看见的事。
 */
function useReleaseStageLabel() {
  const t = useTranslations("enums.releaseStage");
  /* 词条键 == 受管值，所以按值取；认不得的值原样回显那个码，不编一个「其他」。
     2026-10-29 改名（ga→stable / developing→preview / 新增 sunset）时，原先那条
     三元链要逐个分支改，漏一个就静默显示成裸码——按值域遍历就没有这种漏法。 */
  return (stage: string) => (isValidReleaseStage(stage) ? t(stage) : stage);
}

function useResetPeriodLabel() {
  const t = useTranslations("enums.resetPeriod");
  return (period: string) =>
    period === "none"
      ? t("none")
      : period === "day"
        ? t("day")
        : period === "month"
          ? t("month")
          : period;
}

function useSurfaceLabel() {
  const t = useTranslations("enums.productSurface");
  return (surface: string) =>
    surface === "web"
      ? t("web")
      : surface === "desktop"
        ? t("desktop")
        : surface === "app"
          ? t("app")
          : surface === "miniprogram"
            ? t("miniprogram")
            : surface;
}

/** 标题行后面那一枚一枚的状态标。 */
function HeadTag({
  icon,
  children,
  tone,
}: {
  icon?: IconName;
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "brand";
}) {
  if (tone) {
    return (
      <StatusBadge tone={tone} icon={false}>
        {children}
      </StatusBadge>
    );
  }
  return (
    <Badge variant="outline" className="inline-flex items-center gap-2xs">
      {icon ? (
        <Icon name={icon} size="xs" fallback="placeholder" aria-hidden="true" />
      ) : null}
      {children}
    </Badge>
  );
}

export function ProductCapabilityDetailPage({
  productCode,
}: {
  productCode: string;
}) {
  const locale = useLocale();
  const router = useRouter();
  const tableLabels = useTableLabels();
  const capabilityTypeLabels = useCapabilityTypeLabels();
  const mergeStrategyLabels = useMergeStrategyLabels();
  const productLayerLabels = useProductLayerLabels();
  const releaseStageLabel = useReleaseStageLabel();
  const resetPeriodLabel = useResetPeriodLabel();
  const surfaceLabel = useSurfaceLabel();
  const [product, setProduct] = useState<ProductCapabilityRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchProductCapability(productCode)
      .then((record) => {
        if (active) setProduct(record);
      })
      .catch(() => {
        if (active) setProduct(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productCode]);

  const metricColumns: DataTableColumn<
    ProductCapabilityRecord["metrics"][number]
  >[] = useMemo(
    () => [
      {
        id: "name",
        /* 中文名与说明（`display_name` / `description`）2026-09-22 才加列，存量
           19 条待运维台补录。**没填就回落显示代码**，不在界面上编一个——平台替
           产品命名必然错。回落时副题留空，免得同一个串画两遍。 */
        header: "计量名称",
        cell: (metric) => (
          <TableTitleCell
            icon="chart-bar"
            title={metric.metricName || metric.metricCode}
            {...(metric.metricName ? { description: metric.metricCode } : {})}
          />
        ),
      },
      {
        id: "description",
        header: "说明",
        cell: (metric) => metric.metricDescription || "—",
      },
      {
        id: "unit",
        header: "单位",
        align: "center",
        width: "xs",
        cell: (metric) => <Badge>{metric.unit || "—"}</Badge>,
      },
      {
        id: "quota",
        header: "配额策略",
        align: "center",
        width: "xs",
        cell: (metric) => (
          <Badge variant="outline">
            {mergeStrategyLabels[
              metric.quotaBase as keyof typeof mergeStrategyLabels
            ] ?? metric.quotaBase}
          </Badge>
        ),
      },
      {
        id: "cycle",
        header: "重置周期",
        align: "center",
        width: "xs",
        cell: (metric) => resetPeriodLabel(metric.cycle),
      },
    ],
    [mergeStrategyLabels, resetPeriodLabel],
  );

  const versionColumns: DataTableColumn<ProductPlanVersionRecord>[] = useMemo(
    () => [
      {
        id: "version",
        header: "版本代码",
        cell: (version) => (
          <TableTitleCell
            icon="package"
            title={`${version.planCode} v${version.versionNo}`}
            description={version.planName}
            onTitleClick={() =>
              router.push(
                `/plan-versions/${encodeURIComponent(productCode)}/${encodeURIComponent(version.planCode)}/${version.versionNo}`,
              )
            }
          />
        ),
      },
      {
        id: "note",
        header: "版本说明",
        align: "center",
        width: "sm",
        cell: (version) => (
          <span className="inline-flex flex-wrap justify-center gap-2xs">
            <StatusBadge
              tone={version.status === "published" ? "success" : "neutral"}
            >
              {version.status === "published" ? "已发布" : "草稿"}
            </StatusBadge>
            {/* 本产品在这个套餐里是主售品还是搭售件——同一个套餐版本可以两者都挂。 */}
            <Badge variant="outline">
              {version.componentRole === "primary" ? "主售" : "搭售"}
            </Badge>
          </span>
        ),
      },
      {
        id: "created",
        /* **创建时间，不是发布时间**：plan_versions 没有 published_at——发布
             这个动作冻结了版本（is_locked）却没记时刻。不拿 created_at 冒充
             发布时间（owner 2026-09-21 同意）。 */
        header: "创建时间",
        align: "center",
        width: "sm",
        cell: (version) => formatDate(version.createdAt, locale),
      },
    ],
    [locale, productCode, router],
  );

  const backLink = (
    /* 面包屑（owner 2026-09-21：二级页面增加面包屑）。 */
    <nav
      className="flex min-w-0 items-center gap-2xs text-body-sm text-muted-foreground"
      aria-label="面包屑"
    >
      <Link
        className="font-extrabold text-primary-text no-underline"
        href="/products"
      >
        产品目录
      </Link>
      <Icon name="chevron-right" size="xs" fallback="placeholder" />
      <span className="min-w-0 truncate text-foreground">
        {product?.productName ?? productCode}
      </span>
    </nav>
  );

  if (!product) {
    return (
      <DetailPageTemplate className="min-w-0" header={backLink}>
        <EmptyState
          title={loading ? "正在加载产品" : "产品不存在"}
          description={
            loading ? "正在读取产品详情。" : "该产品不存在或已被删除。"
          }
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="min-w-0"
      header={
        <>
          {backLink}

          {/* 唯一的标题行：图标 + 名字 + 代码 + 一排状态标 + 右侧跳转。 */}
          <header className="flex min-w-0 flex-wrap items-center gap-sm">
            <Icon
              name={capabilityTypeIcon(product.productType)}
              size="md"
              fallback="placeholder"
              aria-hidden="true"
              className="shrink-0 text-muted-foreground"
            />
            <h1 className="m-0 min-w-0 truncate text-title-xl font-semibold text-foreground">
              {product.productName}
            </h1>
            <span className="shrink-0 text-body-sm font-extrabold text-muted-foreground">
              {product.productCode}
            </span>

            <div className="flex min-w-0 flex-wrap items-center gap-xs">
              <HeadTag>{capabilityTypeLabels[product.productType]}</HeadTag>
              <HeadTag>{sourceLabel(product.source)}</HeadTag>
              <HeadTag tone={PUBLISH_STATUS_TONE[product.status]}>
                {statusLabel(product.status)}
              </HeadTag>
              <HeadTag icon="shield-check">
                {integrationStatusLabel(product.integration.status)}
              </HeadTag>
              {/* 正式套餐数：不含只有草稿版本的（owner：正式不含草稿）。
                  与总数不等时把差额说出来——「挂着 5 个套餐但一个都没发布」
                  正是运营该一眼看见的事。 */}
              <HeadTag icon="package">
                {product.publishedPlanCount === product.planCount
                  ? `套餐 ${formatNumber(product.publishedPlanCount)} 个`
                  : `套餐 ${formatNumber(product.publishedPlanCount)} / ${formatNumber(product.planCount)} 个`}
              </HeadTag>
              <HeadTag icon="chart-bar">
                {`计量 ${formatNumber(product.metrics.length)} 项`}
              </HeadTag>
            </div>

            <div className="ml-auto inline-flex shrink-0 flex-wrap items-center gap-sm">
              {/* 营销配置是**同级**的独立页，不是这一页的子页——两者互为跳转
                  （owner 2026-09-21）。 */}
              <Button
                variant="outline"
                onClick={() =>
                  router.push(
                    `/products/${encodeURIComponent(product.productCode)}/marketing`,
                  )
                }
              >
                <Icon name="edit" size="xs" fallback="placeholder" />
                营销配置
              </Button>
            </div>
          </header>

          {/* 带理由跳过上线闸门的产品，常驻提示。这一页是运营唯一能看见
              「这个产品的接入门被绕过了」的地方。 */}
          {product.launchOverrideAt ? (
            <Banner
              tone="warning"
              title="本产品跳过了上线闸门"
              description={`于 ${formatDate(product.launchOverrideAt, locale)} 带理由跳过；当时尚未满足 ${formatNumber(product.launchOverridePending.length)} 项必填检查${
                product.launchOverridePending.length
                  ? `（${product.launchOverridePending.join("、")}）`
                  : ""
              }。理由记在审计日志。`}
            />
          ) : null}
        </>
      }
    >
      <Section
        tone="glass"
        level={2}
        icon="database"
        title="基础资料"
        className="min-w-0"
      >
        <DetailList columns={3}>
          <DetailRow label="产品代码">{orUnset(product.productCode)}</DetailRow>
          <DetailRow label="产品名称">{orUnset(product.productName)}</DetailRow>
          <DetailRow label="英文名称">
            {orUnset(product.productNameEn)}
          </DetailRow>

          <DetailRow label="产品分类">
            {orUnset(product.categoryName)}
          </DetailRow>
          <DetailRow label="产品分层">
            {orUnset(
              product.layer
                ? (productLayerLabels[
                    product.layer as keyof typeof productLayerLabels
                  ] ?? product.layer)
                : "",
            )}
          </DetailRow>
          <DetailRow label="产品类型">
            {capabilityTypeLabels[product.productType]}
          </DetailRow>

          <DetailRow label="产品来源">{sourceLabel(product.source)}</DetailRow>
          <DetailRow label="合作方">
            {orUnset(product.originProvider)}
          </DetailRow>
          <DetailRow label="成熟度">
            {releaseStageLabel(product.releaseStage)}
          </DetailRow>

          <DetailRow label="订阅模式">
            {product.standaloneSubscribable ? "可单独订阅" : "仅随方案搭售"}
          </DetailRow>
          <DetailRow label="订阅开放">
            {product.planCount
              ? `${formatNumber(product.publicPlanCount)} / ${formatNumber(product.planCount)} 个套餐开放自助购买`
              : "—"}
          </DetailRow>
          <DetailRow label="终端支持">
            {product.surfaces.length
              ? product.surfaces.map(surfaceLabel).join(" · ")
              : "—"}
          </DetailRow>

          <DetailRow label="可见范围">
            {`客户端${product.visibility === "public" ? "可见" : "不可见"} · 运营端${
              product.isWorkforceVisible ? "可见" : "不可见"
            }`}
          </DetailRow>
          <DetailRow label="产品版本">
            {orUnset(product.releaseVersion)}
          </DetailRow>
          <DetailRow label="发布时间">
            {product.releasedAt ? formatDate(product.releasedAt, locale) : "—"}
          </DetailRow>

          <DetailRow label="创建时间">
            {formatDate(product.createdAt, locale)}
          </DetailRow>
          <DetailRow label="更新时间">
            {formatDate(product.updatedAt, locale)}
          </DetailRow>
          <DetailRow label="上线方式">
            {product.launchOverrideAt ? "跳过闸门" : "正常上线"}
          </DetailRow>
        </DetailList>
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="workflow"
        title={`关联方案 ${formatNumber(product.relatedSolutions.length)} 个`}
        className="min-w-0"
      >
        {product.relatedSolutions.length ? (
          /* 每个方案一个**全宽**卡片，点进解决方案（owner 2026-09-21）。 */
          /* 每个方案一个**全宽卡片**（owner 2026-09-21）。跳转交给
             `TableTitleCell` 的可点标题——与全站「标题可点跳详情」同一个交互；
             整张卡做成按钮会和卡内的徽章抢焦点，而 DS 的 PanelItem 刻意不出
             onClick（见它的文件头）。 */
          <div className="grid min-w-0 gap-sm">
            {product.relatedSolutions.map((solution) => (
              <Card key={solution.solutionCode} className="min-w-0">
                <CardContent className="flex min-w-0 flex-wrap items-center gap-sm">
                  <TableTitleCell
                    icon="workflow"
                    title={solution.solutionName}
                    description={solution.solutionCode}
                    onTitleClick={() =>
                      router.push(
                        `/product-solutions/${encodeURIComponent(solution.solutionCode)}`,
                      )
                    }
                  />
                  <span className="ml-auto inline-flex shrink-0 flex-wrap items-center gap-xs">
                    <Badge variant="outline">{solution.role}</Badge>
                    <StatusBadge tone={PUBLISH_STATUS_TONE[solution.status]}>
                      {statusLabel(solution.status)}
                    </StatusBadge>
                    {solution.tierNames.map((tier) => (
                      <Badge key={tier}>{tier}</Badge>
                    ))}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            title="暂未被业务方案引用"
            description="该产品还没有被任何解决方案引用。"
          />
        )}
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="chart-bar"
        title={`计量配置 ${formatNumber(product.metrics.length)} 项`}
        className="min-w-0"
      >
        {product.metrics.length ? (
          /* 不翻页、全展开（owner 2026-09-21）：计量项是个位数到几十条，
             翻页会让人以为还有别的。 */
          <DataTable
            labels={tableLabels}
            columns={metricColumns}
            rows={product.metrics}
            rowKey={(metric) => metric.metricCode}
            indexStart={1}
            aria-label="计量配置"
          />
        ) : (
          <EmptyState
            title="暂无计量项"
            description="该产品还没有登记计量配置。计量在运维台的产品接入页录入。"
          />
        )}
      </Section>

      <Section
        tone="glass"
        level={2}
        icon="package"
        title={`套餐版本 ${formatNumber(product.planVersions.length)} 个`}
        className="min-w-0"
        description="产品级没有发布历史（库里只有一个当前版本号）；这里列的是该产品参与的套餐版本。"
      >
        {product.planVersions.length ? (
          <DataTable
            labels={tableLabels}
            columns={versionColumns}
            rows={product.planVersions}
            rowKey={(version) => `${version.planCode}-${version.versionNo}`}
            indexStart={1}
            aria-label="套餐版本"
          />
        ) : (
          <EmptyState
            title="暂无套餐版本"
            description="该产品还没有被任何套餐引用。"
          />
        )}
      </Section>
    </DetailPageTemplate>
  );
}
