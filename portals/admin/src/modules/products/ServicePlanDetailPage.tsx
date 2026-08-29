"use client";

/**
 * ServicePlanDetailPage —— 服务套餐详情（方案档位上绑的 plan 的当前版本：价格 · 组件权益 · 计数）。
 *
 * 只读。价格/配额改动在「套餐版本」页；绑定关系在方案详情页。
 * 2026-08-31 去 mock：原「适用范围」「售卖提示」两段是手写文案、库里没有来源，已删。
 */

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
import { fetchProductServicePlan } from "@/api/admin-bff";
import type { ProductServicePlanDetailRecord } from "@/entities/console";
import { SOLUTION_STATUS_TONE } from "@/modules/shared/publish-tone";
import { tierBadgeClass } from "@/modules/shared/tier-level";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import { formatDate, formatNumber } from "@/modules/tenants/tenant-utils";
import { capabilityTypeIcon, useSolutionLabels } from "./solution-labels";

function ServicePlanSummary({
  plan,
}: {
  plan: ProductServicePlanDetailRecord;
}) {
  const t = useTranslations("servicePlanDetailPage");
  const labels = useSolutionLabels();
  return (
    <DetailSummaryHeader
      icon="star"
      title={
        <>
          {plan.solutionName} / {plan.tierName}
        </>
      }
      subtitle={
        <>
          {plan.solutionCode} · {plan.planCode}
        </>
      }
      badges={
        <>
          <Badge className={tierBadgeClass(plan.tierCode)}>
            {labels.tier(plan.tierCode)}
          </Badge>
          <StatusBadge tone={SOLUTION_STATUS_TONE[plan.status]}>
            {labels.status(plan.status)}
          </StatusBadge>
          <StatusBadge tone={plan.isPublic ? "success" : "neutral"}>
            {labels.visibility(plan.isPublic ? "public" : "internal")}
          </StatusBadge>
        </>
      }
      aside={
        <MetricGrid
          items={[
            {
              id: "price",
              label: t("summary.price"),
              value: plan.price.priceLabel,
              tags: [
                plan.price.periodType === "contract"
                  ? labels.priceKind("contract")
                  : plan.price.price === 0
                    ? labels.priceKind("free")
                    : labels.priceKind("paid"),
              ],
            },
            {
              id: "included",
              help: t("summary.includedHelp"),
              label: t("summary.included"),
              value: formatNumber(plan.includedProductCount),
              tags: [
                t("summary.excludedTag", { count: plan.excludedProductCount }),
              ],
            },
            {
              id: "subscriptions",
              help: t("summary.subscriptionsHelp"),
              label: t("summary.subscriptions"),
              value: formatNumber(plan.subscriptionCount),
              tags: [
                t("summary.tenantsTag", { count: plan.activeTenantCount }),
              ],
            },
            {
              id: "version",
              help: t("summary.versionHelp"),
              label: t("summary.version"),
              value: plan.versionNo === null ? "—" : `v${plan.versionNo}`,
              tags: [
                plan.versionStatus === "published"
                  ? t("summary.versionPublished")
                  : plan.versionStatus === "draft"
                    ? t("summary.versionDraft")
                    : t("summary.versionNone"),
              ],
            },
          ]}
        />
      }
    />
  );
}

function ServicePlanDetails({
  plan,
}: {
  plan: ProductServicePlanDetailRecord;
}) {
  const t = useTranslations("servicePlanDetailPage");
  const tShared = useTranslations();
  const labels = useSolutionLabels();
  const locale = useLocale();
  return (
    <section
      className="grid min-w-0 gap-xl"
      aria-label={`${plan.solutionName} ${plan.tierName}`}
    >
      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="database" title={t("sections.basics")} />
        <DetailList columns={3}>
          <DetailRow label={t("fields.solution")}>
            {orUnset(plan.solutionName)}
          </DetailRow>
          <DetailRow label={t("fields.solutionCode")}>
            {orUnset(plan.solutionCode)}
          </DetailRow>
          <DetailRow label={t("fields.tier")}>
            {labels.tier(plan.tierCode)}
          </DetailRow>
          <DetailRow label={t("fields.plan")}>
            {orUnset(plan.tierName)}
          </DetailRow>
          <DetailRow label={t("fields.planCode")}>
            {orUnset(plan.planCode)}
          </DetailRow>
          <DetailRow label={t("fields.status")}>
            {labels.status(plan.status)}
          </DetailRow>
          <DetailRow label={t("fields.visibility")}>
            {labels.visibility(plan.isPublic ? "public" : "internal")}
          </DetailRow>
          <DetailRow label={t("fields.ownerTeam")}>
            {orUnset(plan.ownerTeam)}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(plan.updatedAt, locale))}
          </DetailRow>
        </DetailList>
        {plan.summary || plan.deliveryMode ? (
          <div className="grid min-w-0 gap-xs">
            {plan.summary ? (
              <strong className="text-body-md leading-relaxed font-semibold text-foreground">
                {plan.summary}
              </strong>
            ) : null}
            {plan.deliveryMode ? (
              <p className="m-0 text-body-sm leading-loose text-muted-foreground">
                {plan.deliveryMode}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="chart-bar" title={t("sections.pricing")} />
        <DetailList columns={3}>
          <DetailRow label={t("fields.price")}>
            {orUnset(plan.price.priceLabel)}
          </DetailRow>
          <DetailRow label={tShared("columns.currency")}>
            {orUnset(plan.price.currency)}
          </DetailRow>
          <DetailRow label={t("fields.period")}>
            {t(`period.${plan.price.periodType}`, {
              count: plan.price.periodValue,
            })}
          </DetailRow>
          <DetailRow label={t("fields.version")}>
            {plan.versionNo === null ? orUnset(null) : `v${plan.versionNo}`}
          </DetailRow>
          <DetailRow label={t("fields.subscriptions")}>
            {formatNumber(plan.subscriptionCount)}
          </DetailRow>
          <DetailRow label={t("fields.tenants")}>
            {formatNumber(plan.activeTenantCount)}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="cube" title={t("sections.entitlements")} />
        {plan.entitlements.length ? (
          <PanelList>
            {plan.entitlements.map((item) => (
              <PanelItem
                key={item.productCode}
                className="relative rounded-md transition-colors hover:bg-primary-muted/40"
                lead={
                  <Icon
                    name={capabilityTypeIcon(item.productType)}
                    size="sm"
                    fallback="placeholder"
                  />
                }
                main={
                  <Link
                    href={`/products/${encodeURIComponent(item.productCode)}`}
                    className="no-underline after:absolute after:inset-0 after:content-['']"
                  >
                    <TableTitleCell
                      title={item.productName}
                      description={`${labels.capabilityType(item.productType)} | ${labels.source(item.source)}${item.role ? ` | ${item.role}` : ""}`}
                    />
                  </Link>
                }
                trail={
                  /* `PanelItem` 的 trail 槽是写死的 `shrink-0 text-right`，不肯收缩：
                     配额摘要不定长，不封顶就会把 main 槽挤成 0 宽。 */
                  <span className="grid max-w-panel-sm gap-2xs text-right">
                    <span
                      title={item.quotaSummary}
                      className={`truncate text-body-md font-semibold ${
                        item.included
                          ? "text-success-text"
                          : "text-destructive-text"
                      }`}
                    >
                      {item.included
                        ? item.quotaSummary
                          ? `${t("entitlement.included")} | ${item.quotaSummary}`
                          : t("entitlement.included")
                        : t("entitlement.excluded")}
                    </span>
                    <span className="truncate text-body-sm text-muted-foreground">
                      {item.included
                        ? item.note || t("entitlement.noFeatures")
                        : t("entitlement.excludedNote")}
                    </span>
                  </span>
                }
              />
            ))}
          </PanelList>
        ) : (
          <EmptyState
            title={t("entitlement.emptyTitle")}
            description={t("entitlement.emptyDescription")}
          />
        )}
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="shield-check" title={t("sections.sales")} />
        <DetailList columns={3}>
          <DetailRow label={t("fields.status")}>
            {labels.status(plan.status)}
          </DetailRow>
          <DetailRow label={t("fields.isPublic")}>
            {plan.isPublic ? t("boolean.yes") : t("boolean.no")}
          </DetailRow>
          <DetailRow label={t("fields.customerSegment")}>
            {orUnset(plan.customerSegment)}
          </DetailRow>
          <DetailRow label={t("fields.industry")}>
            {orUnset(plan.industry)}
          </DetailRow>
          <DetailRow label={t("fields.scenario")}>
            {orUnset(plan.scenario)}
          </DetailRow>
        </DetailList>
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
  const t = useTranslations("servicePlanDetailPage");
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
        className="min-w-0"
        header={
          <PageHeader
            icon="star"
            title={t("header.fallbackTitle")}
            description={t("header.notFoundDescription")}
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
          title={t("empty.notFoundTitle")}
          description={t("empty.notFoundDescription")}
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="min-w-0"
      header={
        <PageHeader
          icon="star"
          title={
            plan
              ? `${plan.solutionName} / ${plan.tierName}`
              : t("header.fallbackTitle")
          }
          description={plan?.summary || t("header.loadingDescription")}
          action={
            <div className="inline-flex flex-wrap items-center justify-end gap-sm">
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
                    {t("actions.viewSolution")}
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href="/plan-versions">
                  <Icon name="edit" size="xs" fallback="placeholder" />
                  {t("actions.planVersions")}
                </Link>
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
        <section className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
          <span>{tShared("common.loading")}</span>
        </section>
      )}
    </DetailPageTemplate>
  );
}
