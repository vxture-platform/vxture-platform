"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
  StatusBadge,
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
    <section className="vx-product-capability-summary">
      <div className="vx-product-capability-summary__identity">
        <span
          className="vx-product-capability-summary__icon"
          aria-hidden="true"
        >
          <Icon name="workflow" size="lg" fallback="placeholder" />
        </span>
        <div>
          <h2>{solution.solutionName}</h2>
          <p>{solution.solutionCode}</p>
          <div className="vx-product-capability-summary__badges">
            <StatusBadge tone={PUBLISH_STATUS_TONE[solution.status]}>
              {solutionStatusLabel(solution.status)}
            </StatusBadge>
            <StatusBadge tone={VISIBILITY_TONE[solution.visibility]}>
              {solution.visibility === "public" ? "公开" : "内部"}
            </StatusBadge>
          </div>
        </div>
      </div>
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
    </section>
  );
}

function ProductSolutionDetails({
  solution,
}: {
  solution: ProductSolutionDetailRecord;
}) {
  const tShared = useTranslations();
  return (
    <section
      className="vx-product-capability-detail"
      aria-label={`${solution.solutionName} 详情`}
    >
      <section className="vx-product-capability-section">
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
            {orUnset(formatDate(solution.createdAt))}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(solution.updatedAt))}
          </DetailRow>
        </DetailList>
      </section>

      <section className="vx-product-capability-section">
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
        <div className="vx-product-capability-description">
          <strong>{solution.description}</strong>
        </div>
        <div className="vx-product-capability-tags">
          {solution.tags.map((tag) => (
            <Badge
              key={tag}
              className="vx-tenant-pill vx-product-capability-pill--tag"
            >
              {tag}
            </Badge>
          ))}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="cube" title="包含产品能力" />
        <div className="vx-product-detail-list">
          {solution.products.map((product) => (
            <Link
              key={product.productCode}
              href={`/products/${encodeURIComponent(product.productCode)}`}
              className="vx-product-detail-list__row"
            >
              <span>
                <Icon
                  name={capabilityTypeIcon(product.productType)}
                  size="sm"
                  fallback="placeholder"
                />
                <strong>{product.productName}</strong>
              </span>
              <small>{product.productCode}</small>
              <em>
                {capabilityTypeLabel(product.productType)} |{" "}
                {sourceLabel(product.source)}
              </em>
              <p>{product.role}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="shield-check" title="交付边界" />
        <div className="vx-product-detail-notes">
          {solution.deliveryBoundaries.map((item) => (
            <article key={item}>
              <Icon name="check" size="xs" fallback="placeholder" />
              <span>{item}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="star" title="关联服务套餐" />
        <div className="vx-product-detail-list">
          {solution.relatedServicePlans.map((plan) => (
            <Link
              key={plan.tierCode}
              href={`/service-plans/${encodeURIComponent(solution.solutionCode)}/${encodeURIComponent(plan.tierCode)}`}
              className="vx-product-detail-list__row"
            >
              <span>
                <Icon name="star" size="sm" fallback="placeholder" />
                <strong>{plan.tierName}</strong>
              </span>
              <small>{plan.tierCode}</small>
              <em>{plan.priceLabel}</em>
              <p>{plan.summary}</p>
            </Link>
          ))}
        </div>
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
        className="vx-product-capability-page"
        header={
          <PageHeader
            icon="workflow"
            title="解决方案详情"
            description="未找到对应的解决方案。"
            action={
              <Button asChild variant="outline">
                <Link href="/product-solutions">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  返回列表
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
      className="vx-product-capability-page"
      header={
        <PageHeader
          icon="workflow"
          title={solution?.solutionName ?? "解决方案详情"}
          description={solution?.description ?? "正在读取解决方案详情。"}
          action={
            <div className="vx-product-capability-actions">
              <Button asChild variant="outline">
                <Link href="/product-solutions">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  返回列表
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
        <section className="vx-tenant-directory__header">
          <span>{tShared("common.loading")}</span>
        </section>
      )}
    </DetailPageTemplate>
  );
}
