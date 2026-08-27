"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
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
import { fetchProductSolution } from "@/api/admin-bff";
import type {
  ProductSolutionCapabilitySource,
  ProductSolutionCapabilityType,
  ProductSolutionDetailRecord,
  ProductSolutionStatus,
} from "@/entities/console";
import {
  PUBLISH_STATUS_TONE,
  VISIBILITY_TONE,
} from "@/modules/shared/publish-tone";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import {
  formatDate,
  formatMoney,
  formatNumber,
} from "@/modules/tenants/tenant-utils";

function solutionStatusLabel(status: ProductSolutionStatus) {
  if (status === "active") return "启用";
  if (status === "draft") return "草稿";
  return "归档";
}

function capabilityTypeLabel(type: ProductSolutionCapabilityType) {
  if (type === "platform") return "平台";
  if (type === "agent") return "智能体";
  if (type === "model") return "模型";
  if (type === "data") return "数据";
  return "服务";
}

function capabilityTypeIcon(type: ProductSolutionCapabilityType): IconName {
  if (type === "platform") return "database";
  if (type === "agent") return "agent";
  if (type === "model") return "cloud";
  if (type === "data") return "table";
  return "server";
}

function sourceLabel(source: ProductSolutionCapabilitySource) {
  return source === "self" ? "自建" : "三方";
}

function ProductSolutionSummary({
  solution,
}: {
  solution: ProductSolutionDetailRecord;
}) {
  return (
    <DetailSummaryHeader
      icon="workflow"
      title={solution.solutionName}
      subtitle={solution.solutionCode}
      badges={
        <>
          <StatusBadge tone={PUBLISH_STATUS_TONE[solution.status]}>
            {solutionStatusLabel(solution.status)}
          </StatusBadge>
          <StatusBadge tone={VISIBILITY_TONE[solution.visibility]}>
            {solution.visibility === "public" ? "公开" : "内部"}
          </StatusBadge>
        </>
      }
      aside={
        <MetricGrid
          items={[
            {
              id: "products",
              help: "本方案关联的产品能力条目数。",
              label: "产品能力",
              value: formatNumber(solution.products.length),
              tags: [
                `三方 ${formatNumber(solution.products.filter((item) => item.source === "partner").length)}`,
              ],
            },
            {
              id: "tiers",
              help: "本方案下的服务套餐数。",
              label: "服务套餐",
              value: formatNumber(solution.tiers.length),
              tags: [solution.tiers.map((tier) => tier.tierName).join(" | ")],
            },
            {
              id: "subscriptions",
              help: "订阅了本方案的订阅实例数。",
              label: "订阅使用",
              value: formatNumber(solution.subscriptionCount),
              tags: [`活跃 ${formatNumber(solution.activeTenantCount)}`],
            },
            {
              id: "revenue",
              label: "月度收入",
              value: formatMoney(solution.monthlyRevenue),
              tags: ["方案口径"],
            },
          ]}
        />
      }
    />
  );
}

function ProductSolutionDetails({
  solution,
}: {
  solution: ProductSolutionDetailRecord;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  return (
    <section
      className="grid min-w-0 gap-xl"
      aria-label={`${solution.solutionName} 详情`}
    >
      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="database" title="基础资料" />
        <DetailList columns={3}>
          <DetailRow label="方案编码">
            {orUnset(solution.solutionCode)}
          </DetailRow>
          <DetailRow label="方案名称">
            {orUnset(solution.solutionName)}
          </DetailRow>
          <DetailRow label="方案状态">
            {orUnset(solutionStatusLabel(solution.status))}
          </DetailRow>
          <DetailRow label="可见范围">
            {solution.visibility === "public" ? "公开" : "内部"}
          </DetailRow>
          <DetailRow label="负责团队">{orUnset(solution.ownerTeam)}</DetailRow>
          <DetailRow label="创建时间">
            {orUnset(formatDate(solution.createdAt, locale))}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(solution.updatedAt, locale))}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="map-pin" title="适用行业" />
        <DetailList columns={3}>
          <DetailRow label="行业领域">{orUnset(solution.industry)}</DetailRow>
          <DetailRow label="业务场景">{orUnset(solution.scenario)}</DetailRow>
          <DetailRow label="客户群体">
            {orUnset(solution.customerSegment)}
          </DetailRow>
          <DetailRow label="交付模式">
            {orUnset(solution.deliveryMode)}
          </DetailRow>
        </DetailList>
        <div className="grid min-w-0 gap-xs">
          <strong className="text-body-md leading-relaxed font-semibold text-foreground">
            {solution.description}
          </strong>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-xs">
          {solution.tags.map((tag) => (
            <StatusBadge key={tag} tone="neutral" icon={false}>
              {tag}
            </StatusBadge>
          ))}
        </div>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="cube" title="包含产品能力" />
        <PanelList>
          {solution.products.map((product) => (
            <PanelItem
              key={product.productCode}
              className="relative rounded-md transition-colors hover:bg-primary-muted/40"
              lead={
                <Icon
                  name={capabilityTypeIcon(product.productType)}
                  size="sm"
                  fallback="placeholder"
                />
              }
              main={
                <Link
                  href={`/products/${encodeURIComponent(product.productCode)}`}
                  className="no-underline after:absolute after:inset-0 after:content-['']"
                >
                  <TableTitleCell
                    title={product.productName}
                    description={product.productCode}
                  />
                </Link>
              }
              trail={
                <span className="grid justify-items-end gap-2xs">
                  <span className="text-body-md font-semibold text-foreground">
                    {capabilityTypeLabel(product.productType)} |{" "}
                    {sourceLabel(product.source)}
                  </span>
                  <span className="truncate text-body-sm text-muted-foreground">
                    {product.role}
                  </span>
                </span>
              }
            />
          ))}
        </PanelList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="shield-check" title="交付边界" />
        <PanelList>
          {solution.deliveryBoundaries.map((item) => (
            <PanelItem
              key={item}
              lead={<Icon name="check" size="xs" fallback="placeholder" />}
              main={
                <span className="text-body-sm text-foreground">{item}</span>
              }
            />
          ))}
        </PanelList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="star" title="关联服务套餐" />
        <PanelList>
          {solution.relatedServicePlans.map((plan) => (
            <PanelItem
              key={plan.tierCode}
              className="relative rounded-md transition-colors hover:bg-primary-muted/40"
              lead={<Icon name="star" size="sm" fallback="placeholder" />}
              main={
                <Link
                  href={`/service-plans/${encodeURIComponent(solution.solutionCode)}/${encodeURIComponent(plan.tierCode)}`}
                  className="no-underline after:absolute after:inset-0 after:content-['']"
                >
                  <TableTitleCell
                    title={plan.tierName}
                    description={plan.tierCode}
                  />
                </Link>
              }
              trail={
                /* 封顶见 SubscriptionDetailPage 的同款注释：trail 槽 `shrink-0`，
                   `truncate` 单独写没有效果——得先有宽度上限才截得断。 */
                <span className="grid max-w-panel-sm gap-2xs text-right">
                  <span className="truncate text-body-md font-semibold text-foreground">
                    {plan.priceLabel}
                  </span>
                  <span
                    title={plan.summary}
                    className="truncate text-body-sm text-muted-foreground"
                  >
                    {plan.summary}
                  </span>
                </span>
              }
            />
          ))}
        </PanelList>
      </section>
    </section>
  );
}

export function ProductSolutionDetailPage({
  solutionCode,
}: {
  solutionCode: string;
}) {
  const tShared = useTranslations();
  const [solution, setSolution] = useState<ProductSolutionDetailRecord | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchProductSolution(solutionCode)
      .then((record) => {
        if (!active) return;
        setSolution(record);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [solutionCode]);

  if (!loading && !solution) {
    return (
      <DetailPageTemplate
        className="min-w-0"
        header={
          <PageHeader
            icon="workflow"
            title="解决方案详情"
            description="未找到对应的解决方案。"
            action={
              <Button asChild variant="outline">
                <Link href="/product-solutions">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
            }
          />
        }
      >
        <EmptyState
          title="解决方案不存在"
          description="该方案可能已归档，或当前账号无权访问。"
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="min-w-0"
      header={
        <PageHeader
          icon="workflow"
          title={solution?.solutionName ?? "解决方案详情"}
          description={solution?.description ?? "正在读取解决方案详情。"}
          action={
            <div className="inline-flex flex-wrap items-center justify-end gap-sm">
              <Button asChild variant="outline">
                <Link href="/product-solutions">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
              <Button variant="outline" disabled>
                <Icon name="edit" size="xs" fallback="placeholder" />
                修改
              </Button>
            </div>
          }
        />
      }
    >
      {solution ? (
        <>
          <ProductSolutionSummary solution={solution} />
          <ProductSolutionDetails solution={solution} />
        </>
      ) : (
        <section className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
          <span>{tShared("common.loading")}</span>
        </section>
      )}
    </DetailPageTemplate>
  );
}
