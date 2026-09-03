"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Banner,
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
  toneSurfaceClasses,
} from "@vxture/design-system";
import { orUnset } from "@/modules/shared/display";
import type { IconName, StatusBadgeTone } from "@vxture/design-system";
import {
  fetchSubscriptionOperation,
  submitSubscriptionOperation,
} from "@/api/admin-bff";
import type {
  ProductSolutionCapabilityType,
  SubscriptionOperationAction,
  SubscriptionOperationDetailRecord,
  SubscriptionOperationQuotaRisk,
  SubscriptionOperationStatus,
} from "@/entities/console";
import {
  QUOTA_RISK_TONE,
  SUBSCRIPTION_OPERATION_TONE,
} from "@/modules/shared/status-tone";
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import {
  canRunSubscriptionAction,
  SubscriptionOperationDialog,
  subscriptionActionDisabledReason,
  subscriptionActionIcon,
  subscriptionActionLabel,
  subscriptionToggleAction,
} from "@/modules/subscriptions/SubscriptionOperationDialog";
import {
  formatDate,
  formatMoney,
  formatNumber,
  typeLabel,
} from "@/modules/tenants/tenant-utils";

/** 时间线圆点的语气。原来是 `--subscription-timeline-bg/-color` 两个变量，
 * 由三个 `--success/--warning/--danger` 修饰类喂进去。 */
const TIMELINE_TONE: Record<string, StatusBadgeTone> = {
  success: "success",
  warning: "warning",
  danger: "danger",
};

/** 待收款订单壳在库里是 suspended，对运营它是「待收款」不是「暂停」（与列表页同判）。 */
function subscriptionStatusLabel(
  record: Pick<SubscriptionOperationDetailRecord, "status" | "pendingOrder">,
) {
  if (record.pendingOrder) return "待收款";
  const status: SubscriptionOperationStatus = record.status;
  if (status === "trialing") return "试用";
  if (status === "active") return "已生效";
  if (status === "expiring") return "即将到期";
  if (status === "overdue") return "逾期";
  if (status === "suspended") return "暂停";
  if (status === "expired") return "已到期";
  return "已取消";
}

function quotaRiskLabel(risk: SubscriptionOperationQuotaRisk) {
  if (risk === "danger") return "高风险";
  if (risk === "warning") return "需关注";
  return "正常";
}

function cycleLabel(cycle: SubscriptionOperationDetailRecord["cycleType"]) {
  if (cycle === "yearly") return "年付";
  if (cycle === "once") return "一次性";
  return "月付";
}

function associationSourceLabel(
  source: SubscriptionOperationDetailRecord["solutionAssociation"]["source"],
) {
  if (source === "solution") return "方案关联";
  return source === "industry_rule" ? "运营规则关联" : "历史套餐兼容";
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

function SubscriptionSummary({
  subscription,
}: {
  subscription: SubscriptionOperationDetailRecord;
}) {
  return (
    <DetailSummaryHeader
      icon="star"
      title={
        <>
          {subscription.tenantName} / {subscription.tierName}
        </>
      }
      subtitle={subscription.subscriptionCode}
      badges={
        <>
          <StatusBadge
            tone={
              subscription.pendingOrder
                ? "warning"
                : SUBSCRIPTION_OPERATION_TONE[subscription.status]
            }
          >
            {subscriptionStatusLabel(subscription)}
          </StatusBadge>
          <StatusBadge tone={QUOTA_RISK_TONE[subscription.quota.risk]}>
            {quotaRiskLabel(subscription.quota.risk)}
          </StatusBadge>
        </>
      }
      aside={
        <MetricGrid
          items={[
            {
              id: "solution",
              help: "本订阅关联的业务方案。",
              label: "业务方案",
              value: subscription.solutionAssociation.solutionName,
              tags: [
                associationSourceLabel(subscription.solutionAssociation.source),
              ],
            },
            {
              id: "revenue",
              help: "本周期实付金额（年付即整年金额，不折成月）。",
              label: "订阅收入",
              value: formatMoney(subscription.payAmount),
              tags: [cycleLabel(subscription.cycleType)],
            },
            {
              id: "quota",
              help: "本周期已用配额占额度的百分比。",
              label: "配额消耗",
              value: `${formatNumber(subscription.quota.usageRate)}%`,
              tags: [`${formatNumber(subscription.quota.maxUsers)} 席位`],
            },
            {
              id: "operation",
              help: "按订阅状态与自动续订设置给出的建议处理动作。",
              label: "运营动作",
              value: subscription.operationHint,
              tags: [subscription.autoRenew ? "自动续期" : "人工跟进"],
            },
          ]}
        />
      }
    />
  );
}

function SubscriptionDetails({
  subscription,
}: {
  subscription: SubscriptionOperationDetailRecord;
}) {
  const locale = useLocale();
  const tShared = useTranslations();
  const servicePlanHref = subscription.solutionAssociation.solutionCode
    ? `/service-plans/${encodeURIComponent(subscription.solutionAssociation.solutionCode)}/${encodeURIComponent(subscription.solutionAssociation.tierCode)}`
    : null;

  return (
    <section
      className="grid min-w-0 gap-xl"
      aria-label={`${subscription.tenantName} 订阅详情`}
    >
      {subscription.pendingOrder ? (
        <Banner
          tone="warning"
          title="这是一笔待收款订单，权益尚未开通"
          description="客户已下单、款项还没确认到账。续期 / 暂停 / 恢复 / 取消对它都不适用：请在订单管理里「确认收款」（记账并自动开通）或「驳回订单」。"
          action={
            subscription.orderNo ? (
              <Button asChild size="sm">
                <Link
                  href={`/orders/${encodeURIComponent(subscription.orderNo)}`}
                >
                  <Icon name="credit-card" size="xs" fallback="placeholder" />
                  去订单确认收款
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}
      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="database" title="基础资料" />
        <DetailList columns={3}>
          <DetailRow label="订阅编码">
            {orUnset(subscription.subscriptionCode)}
          </DetailRow>
          <DetailRow label="订单编号">
            {orUnset(subscription.orderNo)}
          </DetailRow>
          <DetailRow label="租户">{orUnset(subscription.tenantName)}</DetailRow>
          <DetailRow label={tShared("columns.tenantType")}>
            {orUnset(typeLabel(subscription.tenantType))}
          </DetailRow>
          <DetailRow label="订阅状态">
            {orUnset(subscriptionStatusLabel(subscription))}
          </DetailRow>
          <DetailRow label="计费周期">
            {orUnset(cycleLabel(subscription.cycleType))}
          </DetailRow>
          <DetailRow label="自动续期">
            {subscription.autoRenew ? "是" : "否"}
          </DetailRow>
          <DetailRow label="运营创建人">
            {orUnset(subscription.operatorName)}
          </DetailRow>
          <DetailRow label="开通时间">
            {orUnset(formatDate(subscription.startAt, locale))}
          </DetailRow>
          <DetailRow label="到期时间">
            {orUnset(formatDate(subscription.endAt, locale))}
          </DetailRow>
          <DetailRow label="试用结束">
            {orUnset(formatDate(subscription.trialEndAt, locale))}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(subscription.updatedAt, locale))}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="workflow" title="业务方案关联" />
        <DetailList columns={3}>
          <DetailRow label="业务方案">
            {orUnset(subscription.solutionAssociation.solutionName)}
          </DetailRow>
          <DetailRow label="方案编码">
            {subscription.solutionAssociation.solutionCode || "未显式绑定"}
          </DetailRow>
          <DetailRow label="套餐层级">
            {orUnset(subscription.solutionAssociation.tierName)}
          </DetailRow>
          <DetailRow label="关联来源">
            {orUnset(
              associationSourceLabel(subscription.solutionAssociation.source),
            )}
          </DetailRow>
        </DetailList>
        <div className="grid min-w-0 gap-xs">
          <p className="m-0 text-body-sm leading-loose text-muted-foreground">
            {subscription.solutionAssociation.note}
          </p>
        </div>
        <div className="inline-flex flex-wrap items-center justify-end gap-sm justify-start ">
          {subscription.solutionAssociation.solutionCode ? (
            <Button asChild variant="outline">
              <Link
                href={`/product-solutions/${encodeURIComponent(subscription.solutionAssociation.solutionCode)}`}
              >
                <Icon name="workflow" size="xs" fallback="placeholder" />
                业务方案
              </Link>
            </Button>
          ) : null}
          {servicePlanHref ? (
            <Button asChild variant="outline">
              <Link href={servicePlanHref}>
                <Icon name="star" size="xs" fallback="placeholder" />
                服务套餐
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="cube" title="权益快照" />
        <PanelList>
          {subscription.entitlementSnapshot.map((item) => (
            <PanelItem
              key={item.productCode}
              lead={
                <Icon
                  name={capabilityTypeIcon(item.productType)}
                  size="sm"
                  fallback="placeholder"
                />
              }
              main={
                <TableTitleCell
                  title={<>{item.productName}</>}
                  description={
                    <>
                      {capabilityTypeLabel(item.productType)} |{" "}
                      {item.source === "self" ? "自建" : "三方"}
                    </>
                  }
                />
              }
              trail={
                /* `PanelItem` 的 trail 槽是写死的 `shrink-0 text-right`，不肯收缩：
                    配额摘要是不定长的（实测这条 1826px、父容器只有 1440），不封顶就会
                    把 main 槽挤成 0 宽并顶出横向滚动条。main 上这里是四列 grid，每格
                    `overflow:hidden;text-overflow:ellipsis`——封顶加截断是同一行为。 */
                <span className="grid max-w-panel-sm gap-2xs text-right">
                  <span
                    title={item.quotaSummary}
                    className="truncate text-body-md font-semibold text-foreground"
                  >
                    {item.included ? "包含" : "不包含"} | {item.quotaSummary}
                  </span>
                  <span className="truncate text-body-sm text-muted-foreground">
                    {item.note}
                  </span>
                </span>
              }
            />
          ))}
        </PanelList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="chart-bar" title="配额快照" />
        <DetailList columns={3}>
          <DetailRow label="最大席位">
            {orUnset(`${formatNumber(subscription.quota.maxUsers)} 人`)}
          </DetailRow>
          <DetailRow label="Token 配额">
            {orUnset(formatNumber(subscription.quota.periodTokens))}
          </DetailRow>
          <DetailRow label="已消耗 Token">
            {orUnset(formatNumber(subscription.quota.usedTokens))}
          </DetailRow>
          <DetailRow label="消耗比例">
            {orUnset(`${formatNumber(subscription.quota.usageRate)}%`)}
          </DetailRow>
          <DetailRow label="配额周期">
            {orUnset(cycleLabel(subscription.quota.quotaCycle))}
          </DetailRow>
          <DetailRow label="允许模型">
            {orUnset(
              `${formatNumber(subscription.quota.allowedModelCount)} 个`,
            )}
          </DetailRow>
          <DetailRow label="自定义模型">
            {subscription.quota.allowCustomModel ? "允许" : "不允许"}
          </DetailRow>
          <DetailRow label="配额风险">
            {orUnset(quotaRiskLabel(subscription.quota.risk))}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="clock" title="运营记录" />
        <PanelList>
          {subscription.operationTimeline.map((event) => (
            <PanelItem
              key={event.id}
              lead={
                <span
                  aria-hidden="true"
                  className={`inline-grid size-icon-md place-items-center rounded-full border ${toneSurfaceClasses[TIMELINE_TONE[event.tone] ?? "neutral"]}`}
                >
                  <Icon
                    name={
                      event.tone === "danger"
                        ? "warning"
                        : event.tone === "success"
                          ? "check"
                          : "info"
                    }
                    size="xs"
                    fallback="placeholder"
                  />
                </span>
              }
              main={
                <span className="grid min-w-0 gap-2xs">
                  <strong className="block text-body-md font-semibold text-foreground">
                    {event.title}
                  </strong>
                  <p className="m-0 text-body-sm leading-relaxed text-muted-foreground">
                    {event.description}
                  </p>
                  <small className="block text-body-sm text-muted-foreground">
                    {event.actor} · {formatDate(event.at, locale)}
                  </small>
                </span>
              }
            />
          ))}
        </PanelList>
      </section>
    </section>
  );
}

export function SubscriptionDetailPage({
  subscriptionId,
}: {
  subscriptionId: string;
}) {
  const tShared = useTranslations();
  const [subscription, setSubscription] =
    useState<SubscriptionOperationDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] =
    useState<SubscriptionOperationAction | null>(null);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchSubscriptionOperation(subscriptionId)
      .then((record) => {
        if (active) setSubscription(record);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [subscriptionId]);

  function requestSubscriptionAction(action: SubscriptionOperationAction) {
    setOperationError(null);
    setOperationFeedback(null);
    setPendingAction(action);
  }

  async function handleSubmitSubscriptionAction(reason: string) {
    if (!subscription || !pendingAction) return;

    setSubmittingAction(true);
    setOperationError(null);

    try {
      const updatedSubscription = await submitSubscriptionOperation(
        subscription.id,
        {
          action: pendingAction,
          reason,
        },
      );

      setSubscription(updatedSubscription);
      setOperationFeedback(`${subscriptionActionLabel(pendingAction)}已完成。`);
      setPendingAction(null);
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "订阅操作失败，请稍后重试。",
      );
    } finally {
      setSubmittingAction(false);
    }
  }

  if (!loading && !subscription) {
    return (
      <DetailPageTemplate
        className="min-w-0"
        header={
          <PageHeader
            icon="star"
            title="订阅详情"
            description="未找到对应的订阅实例。"
            action={
              <Button asChild variant="outline">
                <Link href="/subscriptions">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
            }
          />
        }
      >
        <EmptyState
          title="订阅实例不存在"
          description="该订阅可能已归档，或当前账号无权访问。"
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="min-w-0 vx-subscription-detail-page"
      header={
        <PageHeader
          icon="star"
          title={
            subscription
              ? `${subscription.tenantName} / ${subscription.tierName}`
              : "订阅详情"
          }
          description={
            subscription?.solutionAssociation.note ??
            "正在读取租户订阅权益实例。"
          }
          action={
            <div className="inline-flex flex-wrap items-center justify-end gap-sm">
              <Button asChild variant="outline">
                <Link href="/subscriptions">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
              {subscription ? (
                <Button asChild variant="outline">
                  <Link
                    href={`/tenants/${encodeURIComponent(subscription.tenantCode)}`}
                  >
                    <Icon name="buildings" size="xs" fallback="placeholder" />
                    租户详情
                  </Link>
                </Button>
              ) : null}
              {subscription?.pendingOrder && subscription.orderNo ? (
                /* 待收款订单壳：钱的动作在订单侧，这里给唯一出口；下面四个订阅动作
                   随 pendingOrder 一律禁用（title 里写明原因）。 */
                <Button asChild>
                  <Link
                    href={`/orders/${encodeURIComponent(subscription.orderNo)}`}
                  >
                    <Icon name="credit-card" size="xs" fallback="placeholder" />
                    确认收款
                  </Link>
                </Button>
              ) : null}
              {subscription ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => requestSubscriptionAction("renew")}
                    disabled={!canRunSubscriptionAction("renew", subscription)}
                    title={
                      subscriptionActionDisabledReason("renew", subscription) ??
                      undefined
                    }
                  >
                    <Icon
                      name={subscriptionActionIcon("renew")}
                      size="xs"
                      fallback="placeholder"
                    />
                    {subscriptionActionLabel("renew")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      requestSubscriptionAction(
                        subscriptionToggleAction(subscription.status),
                      )
                    }
                    disabled={
                      !canRunSubscriptionAction(
                        subscriptionToggleAction(subscription.status),
                        subscription,
                      )
                    }
                    title={
                      subscriptionActionDisabledReason(
                        subscriptionToggleAction(subscription.status),
                        subscription,
                      ) ?? undefined
                    }
                  >
                    <Icon
                      name={subscriptionActionIcon(
                        subscriptionToggleAction(subscription.status),
                      )}
                      size="xs"
                      fallback="placeholder"
                    />
                    {subscriptionActionLabel(
                      subscriptionToggleAction(subscription.status),
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="vx-subscription-action-button--danger"
                    onClick={() => requestSubscriptionAction("cancel")}
                    disabled={!canRunSubscriptionAction("cancel", subscription)}
                    title={
                      subscriptionActionDisabledReason(
                        "cancel",
                        subscription,
                      ) ?? undefined
                    }
                  >
                    <Icon
                      name={subscriptionActionIcon("cancel")}
                      size="xs"
                      fallback="placeholder"
                    />
                    {subscriptionActionLabel("cancel")}
                  </Button>
                </>
              ) : null}
            </div>
          }
        />
      }
    >
      {operationFeedback ? (
        <div className="inline-flex w-fit items-center rounded-lg bg-success-muted px-sm py-xs text-body-sm text-success-text">
          {operationFeedback}
        </div>
      ) : null}

      {subscription ? (
        <>
          <SubscriptionSummary subscription={subscription} />
          <SubscriptionDetails subscription={subscription} />
        </>
      ) : (
        <section className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
          <span>{tShared("common.loading")}</span>
        </section>
      )}

      {subscription && pendingAction ? (
        <SubscriptionOperationDialog
          action={pendingAction}
          subscriptionName={`${subscription.tenantName} / ${subscription.tierName}`}
          busy={submittingAction}
          error={operationError}
          onCancel={() => {
            if (!submittingAction) setPendingAction(null);
          }}
          onSubmit={handleSubmitSubscriptionAction}
        />
      ) : null}
    </DetailPageTemplate>
  );
}
