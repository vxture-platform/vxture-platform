"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Button,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  EmptyState,
  Icon,
  MetricGrid,
  StatusBadge,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { orUnset } from "@/modules/shared/display";
import { fetchProductServicePlan } from "@/api/admin-bff";
import type {
  ProductServicePlanDetailRecord,
  ProductSolutionCapabilityType,
  ProductSolutionStatus,
} from "@/entities/console";
import { PUBLISH_STATUS_TONE } from "@/modules/shared/publish-tone";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";

function statusLabel(status: ProductSolutionStatus) {
  if (status === "active") return "启用";
  if (status === "draft") return "草稿";
  return "归档";
}

function capabilityTypeIcon(type: ProductSolutionCapabilityType): IconName {
  if (type === "platform") return "database";
  if (type === "agent") return "agent";
  if (type === "model") return "cloud";
  if (type === "data") return "table";
  return "server";
}

function capabilityTypeLabel(type: ProductSolutionCapabilityType) {
  if (type === "platform") return "平台";
  if (type === "agent") return "智能体";
  if (type === "model") return "模型";
  if (type === "data") return "数据";
  return "服务";
}

function ServicePlanSummary({
  plan,
}: {
  plan: ProductServicePlanDetailRecord;
}) {
  return (
    <section className="vx-product-capability-summary">
      <div className="vx-product-capability-summary__identity">
        <span
          className="vx-product-capability-summary__icon"
          aria-hidden="true"
        >
          <Icon name="star" size="lg" fallback="placeholder" />
        </span>
        <div>
          <h2>
            {plan.solutionName} / {plan.tierName}
          </h2>
          <p>
            {plan.solutionCode} · {plan.tierCode}
          </p>
          <div className="vx-product-capability-summary__badges">
            <StatusBadge tone={PUBLISH_STATUS_TONE[plan.status]}>
              {statusLabel(plan.status)}
            </StatusBadge>
            <StatusBadge tone={plan.isPublic ? "success" : "neutral"}>
              {plan.isPublic ? "公开" : "内部"}
            </StatusBadge>
          </div>
        </div>
      </div>
      <MetricGrid
        items={[
          {
            id: "price",
            label: "价格",
            value: plan.price.priceLabel,
            tags: [
              plan.price.periodType === "contract" ? "专属商务" : "标准价格",
            ],
          },
          {
            id: "included",
            help: "本套餐包含的产品能力数。",
            label: "包含产品",
            value: formatNumber(plan.includedProductCount),
            tags: [`不含 ${formatNumber(plan.excludedProductCount)}`],
          },
          {
            id: "subscriptions",
            help: "使用本套餐的订阅实例数。",
            label: "订阅使用",
            value: formatNumber(plan.subscriptionCount),
            tags: [`活跃 ${formatNumber(plan.activeTenantCount)}`],
          },
          {
            id: "scope",
            help: "本套餐适用范围条目数。",
            label: "适用范围",
            value: formatNumber(plan.applicableScope.length),
            tags: [plan.industry],
          },
        ]}
      />
    </section>
  );
}

function ServicePlanDetails({
  plan,
}: {
  plan: ProductServicePlanDetailRecord;
}) {
  const tShared = useTranslations();
  return (
    <section
      className="vx-product-capability-detail"
      aria-label={`${plan.solutionName} ${plan.tierName} 详情`}
    >
      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="database" title="基础资料" />
        <DetailList columns={3}>
          <DetailRow label="业务方案">{orUnset(plan.solutionName)}</DetailRow>
          <DetailRow label="方案编码">{orUnset(plan.solutionCode)}</DetailRow>
          <DetailRow label="套餐版本">{orUnset(plan.tierName)}</DetailRow>
          <DetailRow label="版本编码">{orUnset(plan.tierCode)}</DetailRow>
          <DetailRow label="套餐状态">
            {orUnset(statusLabel(plan.status))}
          </DetailRow>
          <DetailRow label="可见范围">
            {plan.isPublic ? "公开" : "内部"}
          </DetailRow>
          <DetailRow label="负责团队">{orUnset(plan.ownerTeam)}</DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(plan.updatedAt))}
          </DetailRow>
        </DetailList>
        <div className="vx-product-capability-description">
          <strong>{plan.summary}</strong>
          <p>{plan.deliveryMode}</p>
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="chart-bar" title="配额价格" />
        <DetailList columns={3}>
          <DetailRow label="价格">{orUnset(plan.price.priceLabel)}</DetailRow>
          <DetailRow label={tShared("columns.currency")}>
            {orUnset(plan.price.currency)}
          </DetailRow>
          <DetailRow label="周期">
            {plan.price.periodType === "contract"
              ? "合同约定"
              : plan.price.periodType === "yearly"
                ? "年付"
                : "月付"}
          </DetailRow>
          <DetailRow label="订阅数量">{`${formatNumber(plan.subscriptionCount)} 个`}</DetailRow>
          <DetailRow label="活跃租户">{`${formatNumber(plan.activeTenantCount)} 个`}</DetailRow>
        </DetailList>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="cube" title="包含 / 不包含产品" />
        <div className="vx-product-detail-list vx-product-detail-list--entitlements">
          {plan.entitlements.map((item) => (
            <Link
              key={item.productCode}
              href={`/products/${encodeURIComponent(item.productCode)}`}
              className="vx-product-detail-list__row"
            >
              <span>
                <Icon
                  name={capabilityTypeIcon(item.productType)}
                  size="sm"
                  fallback="placeholder"
                />
                <strong>{item.productName}</strong>
              </span>
              <small>
                {capabilityTypeLabel(item.productType)} |{" "}
                {item.source === "self" ? "自建" : "三方"}
              </small>
              <em className={item.included ? "is-included" : "is-excluded"}>
                {item.included ? "包含" : "不包含"} | {item.quotaSummary}
              </em>
              <p>{item.note}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="map-pin" title="适用范围" />
        <div className="vx-product-detail-notes">
          {plan.applicableScope.map((item) => (
            <article key={item}>
              <Icon name="check" size="xs" fallback="placeholder" />
              <span>{item}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="shield-check" title="售卖状态" />
        <DetailList columns={3}>
          <DetailRow label="售卖状态">
            {orUnset(statusLabel(plan.status))}
          </DetailRow>
          <DetailRow label="公开售卖">{plan.isPublic ? "是" : "否"}</DetailRow>
          <DetailRow label="客户群体">
            {orUnset(plan.customerSegment)}
          </DetailRow>
          <DetailRow label="业务场景">{orUnset(plan.scenario)}</DetailRow>
        </DetailList>
        <div className="vx-product-detail-notes">
          {plan.salesNotes.map((item) => (
            <article key={item}>
              <Icon name="info" size="xs" fallback="placeholder" />
              <span>{item}</span>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export function ServicePlanDetailPage({
  solutionCode,
  tierCode,
}: {
  solutionCode: string;
  tierCode: string;
}) {
  const tShared = useTranslations();
  const [plan, setPlan] = useState<ProductServicePlanDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchProductServicePlan(solutionCode, tierCode)
      .then((record) => {
        if (!active) return;
        setPlan(record);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [solutionCode, tierCode]);

  if (!loading && !plan) {
    return (
      <DetailPageTemplate
        className="vx-product-capability-page"
        header={
          <PageHeader
            icon="star"
            title="服务套餐详情"
            description="未找到对应的服务套餐。"
            action={
              <Button asChild variant="outline">
                <Link href="/service-plans">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
            }
          />
        }
      >
        <EmptyState
          title="服务套餐不存在"
          description="该套餐可能已归档，或当前账号无权访问。"
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="vx-product-capability-page"
      header={
        <PageHeader
          icon="star"
          title={
            plan ? `${plan.solutionName} / ${plan.tierName}` : "服务套餐详情"
          }
          description={plan?.summary ?? "正在读取服务套餐详情。"}
          action={
            <div className="vx-product-capability-actions">
              <Button asChild variant="outline">
                <Link href="/service-plans">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
              {plan ? (
                <Button asChild variant="outline">
                  <Link
                    href={`/product-solutions/${encodeURIComponent(plan.solutionCode)}`}
                  >
                    <Icon name="workflow" size="xs" fallback="placeholder" />
                    业务方案
                  </Link>
                </Button>
              ) : null}
              <Button variant="outline" disabled>
                <Icon name="edit" size="xs" fallback="placeholder" />
                修改
              </Button>
            </div>
          }
        />
      }
    >
      {plan ? (
        <>
          <ServicePlanSummary plan={plan} />
          <ServicePlanDetails plan={plan} />
        </>
      ) : (
        <section className="vx-tenant-directory__header">
          <span>{tShared("common.loading")}</span>
        </section>
      )}
    </DetailPageTemplate>
  );
}
