"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Badge,
  Button,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  EmptyState,
  Icon,
  MetricGrid,
  PanelItem,
  PanelList,
  SHELL_PANEL_HAIRLINE,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import { orUnset } from "@/modules/shared/display";
import type { IconName } from "@vxture/design-system";
import { fetchProductCapability } from "@/api/admin-bff";
import { ProductContentEditDialog } from "./ProductContentEditDialog";
import type {
  ProductCapabilityHealthStatus,
  ProductCapabilityIntegrationStatus,
  ProductCapabilityRecord,
  ProductCapabilitySource,
  ProductCapabilityStatus,
  ProductCapabilityType,
} from "@/entities/console";
import { PUBLISH_STATUS_TONE } from "@/modules/shared/publish-tone";
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";

function capabilityTypeLabel(type: ProductCapabilityType) {
  if (type === "platform") return "平台";
  if (type === "agent") return "智能体";
  if (type === "model") return "模型";
  if (type === "data") return "数据";
  return "服务";
}

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

function healthLabel(status: ProductCapabilityHealthStatus) {
  if (status === "normal") return "正常";
  if (status === "warning") return "需关注";
  return "不可用";
}

function regionLabel(region: ProductCapabilityRecord["region"]) {
  if (region === "domestic") return "国内";
  if (region === "international") return "国际";
  return "全局";
}

function ProductCapabilitySummary({
  product,
}: {
  product: ProductCapabilityRecord;
}) {
  return (
    <DetailSummaryHeader
      icon={capabilityTypeIcon(product.productType)}
      title={product.productName}
      subtitle={product.productCode}
      badges={
        <>
          <Badge>{capabilityTypeLabel(product.productType)}</Badge>
          <Badge>{sourceLabel(product.source)}</Badge>
          <StatusBadge tone={PUBLISH_STATUS_TONE[product.status]}>
            {statusLabel(product.status)}
          </StatusBadge>
        </>
      }
      aside={
        <MetricGrid
          items={[
            {
              id: "solutions",
              help: "引用了本产品的业务方案数。",
              label: "业务方案",
              value: formatNumber(product.solutionCount),
              tags: [`${formatNumber(product.planCount)} 套餐`],
            },
            {
              id: "integration",
              help: "本能力对接平台的进度：无需接入 / 待配置 / 联调中 / 已接入。",
              label: "接入状态",
              value: integrationStatusLabel(product.integration.status),
              tags: [product.integration.providerName],
            },
            {
              id: "metering",
              label: "计量单位",
              value: product.meteringUnit,
              tags: [product.billingMode],
            },
            {
              id: "health",
              help: "本能力当前可用状态：正常 / 需关注 / 不可用。",
              label: "可用状态",
              value: healthLabel(product.healthStatus),
              tags: [`${formatNumber(product.modelPolicyCount)} 模型授权`],
            },
          ]}
        />
      }
    />
  );
}

function ProductCapabilityDetails({
  product,
}: {
  product: ProductCapabilityRecord;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  return (
    <section
      className="grid min-w-0 gap-xl"
      aria-label={`${product.productName} 产品详情`}
    >
      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="database" title="基础资料" />
        <DetailList columns={3}>
          <DetailRow label="产品编码">{orUnset(product.productCode)}</DetailRow>
          <DetailRow label="产品名称">{orUnset(product.productName)}</DetailRow>
          <DetailRow label="产品类型">
            {orUnset(capabilityTypeLabel(product.productType))}
          </DetailRow>
          <DetailRow label="产品来源">
            {orUnset(sourceLabel(product.source))}
          </DetailRow>
          <DetailRow label="可见范围">
            {product.visibility === "public" ? "公开" : "内部"}
          </DetailRow>
          <DetailRow label="服务区域">
            {orUnset(regionLabel(product.region))}
          </DetailRow>
          <DetailRow label="负责团队">{orUnset(product.ownerTeam)}</DetailRow>
          <DetailRow label="创建时间">
            {orUnset(formatDate(product.createdAt, locale))}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(product.updatedAt, locale))}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="sparkles" title="能力属性" />
        <div className="grid min-w-0 gap-xs">
          <strong className="text-body-md leading-relaxed font-semibold text-foreground">
            {product.capabilitySummary}
          </strong>
          <p className="m-0 text-body-sm leading-loose text-muted-foreground">
            {product.description}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-xs">
          {product.accessModes.map((mode) => (
            <StatusBadge key={mode} tone="brand" icon={false}>
              {mode}
            </StatusBadge>
          ))}
          {product.tags.map((tag) => (
            <StatusBadge key={tag} tone="neutral" icon={false}>
              {tag}
            </StatusBadge>
          ))}
        </div>
        <PanelList
          empty={
            <TableTitleCell
              title="暂未被业务方案引用"
              description="后续可在解决方案中配置。"
            />
          }
        >
          {product.relatedSolutions.map((solution) => (
            <PanelItem
              key={`${solution.solutionCode}:${solution.role}`}
              main={
                <TableTitleCell
                  title={solution.solutionName}
                  description={solution.role}
                />
              }
              trail={
                <span className="truncate text-body-sm text-muted-foreground">
                  {solution.tierNames.join(" | ")}
                </span>
              }
            />
          ))}
        </PanelList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="api" title="接入配置" />
        <DetailList columns={3}>
          <DetailRow label="供应商">
            {orUnset(product.integration.providerName)}
          </DetailRow>
          <DetailRow label="供应商类型">
            {orUnset(sourceLabel(product.integration.providerType))}
          </DetailRow>
          <DetailRow label="接入状态">
            {orUnset(integrationStatusLabel(product.integration.status))}
          </DetailRow>
          <DetailRow label="协议">
            {orUnset(product.integration.protocol)}
          </DetailRow>
          <DetailRow label="认证方式">
            {orUnset(product.integration.authMode)}
          </DetailRow>
          <DetailRow label="结算方式">
            {product.integration.settlementMode || tShared("common.none")}
          </DetailRow>
          <DetailRow label="接口地址">
            {product.integration.endpoint || "内部能力，无需外部接口"}
          </DetailRow>
          <DetailRow label="最近检测">
            {orUnset(
              product.integration.lastCheckedAt
                ? formatDate(product.integration.lastCheckedAt, locale)
                : "未检测",
            )}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="chart-bar" title="计量配置" />
        <DetailList columns={3}>
          <DetailRow label="默认计量单位">
            {orUnset(product.meteringUnit)}
          </DetailRow>
          <DetailRow label="计费模式">{orUnset(product.billingMode)}</DetailRow>
          <DetailRow label="策略数量">
            {orUnset(`${formatNumber(product.modelPolicyCount)} 个`)}
          </DetailRow>
        </DetailList>
        <PanelList>
          {product.metrics.map((metric) => (
            <PanelItem
              key={metric.metricCode}
              main={
                <TableTitleCell
                  title={metric.metricName}
                  description={metric.metricCode}
                />
              }
              trail={
                /* 同 SubscriptionDetailPage：trail 槽 `shrink-0` 按内容定宽，
                   `truncate` 要先有宽度上限才截得断。 */
                <span className="block max-w-panel-sm truncate text-body-sm text-muted-foreground">
                  {metric.unit} | {metric.cycle} | {metric.quotaBase} |{" "}
                  {metric.billingMode}
                </span>
              }
            />
          ))}
        </PanelList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="shield-check" title="可用状态" />
        <DetailList columns={3}>
          <DetailRow label="能力状态">
            {orUnset(statusLabel(product.status))}
          </DetailRow>
          <DetailRow label="健康状态">
            {orUnset(healthLabel(product.healthStatus))}
          </DetailRow>
          <DetailRow label="发布数量">
            {orUnset(`${formatNumber(product.releaseCount)} 个`)}
          </DetailRow>
          <DetailRow label="方案复用">
            {orUnset(`${formatNumber(product.solutionCount)} 个`)}
          </DetailRow>
        </DetailList>
        <PanelList
          empty={
            <TableTitleCell
              title="暂无发布版本"
              description="该能力当前主要通过业务方案组合使用。"
            />
          }
        >
          {product.releases.map((release) => (
            <PanelItem
              key={release.releaseCode}
              main={
                <TableTitleCell
                  title={release.releaseName}
                  description={release.releaseCode}
                />
              }
              trail={
                <span className="truncate text-body-sm text-muted-foreground">
                  {release.versionLabels.join(" | ")}
                </span>
              }
            />
          ))}
        </PanelList>
      </section>
    </section>
  );
}

export function ProductCapabilityDetailPage({
  productCode,
}: {
  productCode: string;
}) {
  const tShared = useTranslations();
  const [product, setProduct] = useState<ProductCapabilityRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchProductCapability(productCode)
      .then((record) => {
        if (!active) return;
        setProduct(record);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [productCode]);

  if (!loading && !product) {
    return (
      <DetailPageTemplate
        className="min-w-0"
        header={
          <PageHeader
            icon="database"
            title="产品详情"
            description="未找到对应的产品。"
            action={
              <Button asChild variant="outline">
                <Link href="/products">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
            }
          />
        }
      >
        <EmptyState
          title="产品不存在"
          description="该产品可能已下线，或当前账号无权访问。"
          action={
            <Button asChild variant="outline">
              <Link href="/products">返回产品管理</Link>
            </Button>
          }
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="min-w-0"
      header={
        <PageHeader
          icon={product ? capabilityTypeIcon(product.productType) : "database"}
          title={product?.productName ?? "产品详情"}
          description={product?.capabilitySummary ?? "正在读取产品详情。"}
          action={
            <div className="inline-flex flex-wrap items-center justify-end gap-sm">
              <Button asChild variant="outline">
                <Link href="/products">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
              <Button
                variant="outline"
                disabled={!product}
                onClick={() => setEditing(true)}
              >
                <Icon name="edit" size="xs" fallback="placeholder" />
                编辑营销
              </Button>
            </div>
          }
        />
      }
    >
      {product ? (
        <>
          <ProductCapabilitySummary product={product} />
          <ProductCapabilityDetails product={product} />
          <ProductContentEditDialog
            product={product}
            open={editing}
            onOpenChange={setEditing}
            onSaved={setProduct}
          />
        </>
      ) : (
        <section className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
          <span>{tShared("common.loading")}</span>
        </section>
      )}
    </DetailPageTemplate>
  );
}
