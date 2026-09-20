"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Button,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  DialogForm,
  EmptyState,
  Icon,
  Label,
  MetricGrid,
  PanelItem,
  PanelList,
  SHELL_PANEL_HAIRLINE,
  StatusBadge,
  TableTitleCell,
  Textarea,
  toneSurfaceClasses,
} from "@vxture/design-system";
import type { StatusBadgeTone } from "@vxture/design-system";
import { orUnset } from "@/modules/shared/display";
import {
  confirmOrderOfflinePayment,
  fetchOrderOperation,
  rejectOrderPaymentDeclaration,
  restoreOrder,
  voidOrder,
  auditOrderRefund,
  executeOrderRefund,
} from "@/api/admin-bff";
import type { OrderOperationDetailRecord } from "@/entities/console";
import {
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_TONE,
} from "@/modules/shared/status-tone";
import { DetailSummaryHeader } from "@/modules/shared/DetailSummaryHeader";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
import {
  useOrderStatusLabels,
  usePaySourceLabel,
  useSubscriptionCycleLabels,
  useSubscriptionStatusLabels,
} from "@/modules/shared/enum-labels";
import {
  canConfirmOrderOfflinePayment,
  confirmOfflinePaymentDisabledReason,
  OrderOfflinePaymentDialog,
} from "@/modules/orders/OrderOfflinePaymentDialog";
import {
  formatDate,
  formatQuantity,
  typeLabel,
} from "@/modules/tenants/tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";

/** 时间线圆点的语气。原来是 `--subscription-timeline-bg/-color` 两个变量，
 * 由三个 `--success/--warning/--danger` 修饰类喂进去。 */
const TIMELINE_TONE: Record<string, StatusBadgeTone> = {
  success: "success",
  warning: "warning",
  danger: "danger",
};

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

/** 渠道码 → 词条键。文案走 `orderDetailPage.channels.*`，这里只留映射。 */
/** 本页命名空间的取词函数类型。模块级函数收它当参数（组件外拿不到 hook）。 */
type TPage = ReturnType<typeof useTranslations<"orderDetailPage">>;

const DECLARED_CHANNEL_KEYS: Record<string, string> = {
  alipay: "channels.alipay",
  bank: "channels.bank",
};

// 仅真正的待支付订单可驳回——已有任何收款请走结算而非驳回（product_320 §4.3）。
// product_321 P2：已申报（pending_verify）订单须先「驳回申报」再作废。
function canVoidOrder(order: OrderOperationDetailRecord) {
  return (
    order.orderStatus === "pending" &&
    order.paidAmount <= 0 &&
    !order.declaredPayment
  );
}

function voidDisabledReason(order: OrderOperationDetailRecord, tPage: TPage) {
  if (canVoidOrder(order)) return null;
  if (order.paidAmount > 0) return tPage("disabled.hasPayment");
  return tPage("disabled.notPending");
}

// restorable 由后端判定：从未激活过（订阅 end_at 为空）且没有支付记录的
// 已取消/已过期订单才可恢复；已激活后再取消的订阅不在此列（见 admin-bff）。
function restoreDisabledReason(
  order: OrderOperationDetailRecord,
  tPage: TPage,
) {
  if (order.restorable) return null;
  return tPage("disabled.notRestorable");
}

function OrderSummary({ order }: { order: OrderOperationDetailRecord }) {
  const t = useTranslations();
  const tPage = useTranslations("orderDetailPage");
  const cycleLabels = useSubscriptionCycleLabels();
  const paySourceLabel = usePaySourceLabel();
  const orderStatusLabels = useOrderStatusLabels();
  const tShared = useTranslations();
  return (
    <DetailSummaryHeader
      icon="table"
      title={order.orderNo}
      subtitle={
        <>
          {order.tenantName} / {order.tierName}
        </>
      }
      badges={
        <>
          <StatusBadge tone={ORDER_STATUS_TONE[order.orderStatus]}>
            {orderStatusLabels[order.orderStatus]}
          </StatusBadge>
          <StatusBadge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
            {t(`status.orderPayment.${order.paymentStatus}`)}
          </StatusBadge>
        </>
      }
      aside={
        <MetricGrid
          items={[
            {
              id: "amount",
              help: tPage("summary.amountHelp"),
              label: tPage("summary.amount"),
              value: formatCurrency(order.amount, order.currency),
              tags: [cycleLabels[order.cycleType]],
            },
            {
              id: "paid",
              help: tPage("summary.receivedHelp"),
              label: tShared("columns.receivedAmount"),
              value: formatCurrency(order.paidAmount, order.currency),
              tags: [paySourceLabel(order.paySource)],
            },
            {
              id: "solution",
              help: tPage("summary.planHelp"),
              label: tPage("summary.plan"),
              value: order.solutionName,
              tags: [order.servicePlanName],
            },
            {
              id: "operation",
              help: tPage("summary.actionHelp"),
              label: tPage("summary.action"),
              value: order.operationHint,
              tags: [order.operatorName],
            },
          ]}
        />
      }
    />
  );
}

function OrderDetails({ order }: { order: OrderOperationDetailRecord }) {
  const t = useTranslations();
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const tShared = useTranslations();
  const subscriptionStatusLabels = useSubscriptionStatusLabels();
  const cycleLabels = useSubscriptionCycleLabels();
  const paySourceLabel = usePaySourceLabel();
  const orderStatusLabels = useOrderStatusLabels();
  return (
    <section
      className="grid min-w-0 gap-xl"
      aria-label={tPage("summary.ariaLabel", { orderNo: order.orderNo })}
    >
      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="table" title={tPage("sections.basic")} />
        <DetailList columns={3}>
          <DetailRow label={tPage("fields.orderNo")}>
            {orUnset(order.orderNo)}
          </DetailRow>
          <DetailRow label={tPage("fields.orderStatus")}>
            {orUnset(orderStatusLabels[order.orderStatus])}
          </DetailRow>
          <DetailRow label={tPage("fields.payStatus")}>
            {orUnset(t(`status.orderPayment.${order.paymentStatus}`))}
          </DetailRow>
          <DetailRow label={tPage("fields.paySource")}>
            {orUnset(paySourceLabel(order.paySource))}
          </DetailRow>
          <DetailRow label={tPage("fields.payMethod")}>
            {orUnset(order.payMethod)}
          </DetailRow>
          <DetailRow label={tPage("fields.createdAt")}>
            {orUnset(formatDate(order.createdAt, locale))}
          </DetailRow>
          <DetailRow label={tPage("fields.confirmedAt")}>
            {orUnset(formatDate(order.confirmedAt, locale))}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(order.updatedAt, locale))}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading
          icon="buildings"
          title={tPage("sections.tenantPlan")}
        />
        <DetailList columns={3}>
          <DetailRow label={tPage("fields.tenant")}>
            {orUnset(order.tenantName)}
          </DetailRow>
          <DetailRow label={tShared("columns.tenantCode")}>
            {orUnset(order.tenantCode)}
          </DetailRow>
          <DetailRow label={tShared("columns.tenantType")}>
            {orUnset(typeLabel(order.tenantType))}
          </DetailRow>
          <DetailRow label={tPage("fields.region")}>
            {orUnset(order.region)}
          </DetailRow>
          <DetailRow label={tPage("fields.industry")}>
            {orUnset(order.industry)}
          </DetailRow>
          <DetailRow label={tPage("fields.plan")}>
            {orUnset(order.solutionName)}
          </DetailRow>
          <DetailRow label={tPage("fields.servicePlan")}>
            {orUnset(order.servicePlanName)}
          </DetailRow>
          <DetailRow label={tPage("fields.planTier")}>
            {orUnset(order.tierName)}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading
          icon="star"
          title={tPage("sections.subscription")}
        />
        <DetailList columns={3}>
          <DetailRow label={tPage("fields.subscriptionId")}>
            {orUnset(order.subscriptionId)}
          </DetailRow>
          <DetailRow label={tPage("fields.subscriptionStatus")}>
            {orUnset(subscriptionStatusLabels[order.subscriptionStatus])}
          </DetailRow>
          <DetailRow label={tPage("fields.billingCycle")}>
            {orUnset(cycleLabels[order.cycleType])}
          </DetailRow>
        </DetailList>
        <div className="inline-flex flex-wrap items-center justify-end gap-sm justify-start ">
          <Button asChild variant="outline">
            <Link href={`/subscriptions/${encodeURIComponent(order.orderNo)}`}>
              <Icon name="star" size="xs" fallback="placeholder" />
              {tPage("links.subscription")}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/tenants/${encodeURIComponent(order.tenantCode)}`}>
              <Icon name="buildings" size="xs" fallback="placeholder" />
              {tPage("links.tenant")}
            </Link>
          </Button>
        </div>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="key" title={tPage("sections.billing")} />
        <DetailList columns={3}>
          <DetailRow label={tPage("fields.billNo")}>
            {order.billNo || tPage("notGenerated")}
          </DetailRow>
          <DetailRow label={tPage("fields.billStatus")}>
            {order.billStatus || tPage("notGenerated")}
          </DetailRow>
          <DetailRow label={tPage("fields.payNo")}>
            {order.paymentNo || tPage("notGenerated")}
          </DetailRow>
          <DetailRow label={tPage("fields.orderAmount")}>
            {orUnset(formatCurrency(order.amount, order.currency))}
          </DetailRow>
          <DetailRow label={tShared("columns.receivedAmount")}>
            {orUnset(formatCurrency(order.paidAmount, order.currency))}
          </DetailRow>
          <DetailRow label={tPage("fields.remaining")}>
            {orUnset(
              formatCurrency(
                Math.max(0, order.amount - order.paidAmount),
                order.currency,
              ),
            )}
          </DetailRow>
        </DetailList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="list" title={tPage("sections.billItems")} />
        <PanelList>
          {order.invoiceItems.map((item) => (
            <PanelItem
              key={item.id}
              lead={<Icon name="table" size="sm" fallback="placeholder" />}
              main={
                <TableTitleCell
                  title={<>{item.itemName}</>}
                  description={
                    <>
                      {item.itemType} | {formatQuantity(item.quantity)}{" "}
                      {item.itemUnit ?? ""}
                    </>
                  }
                />
              }
              trail={
                <span className="grid justify-items-end gap-2xs">
                  <span className="text-body-md font-semibold text-foreground">
                    {formatCurrency(item.totalAmount, order.currency)}
                  </span>
                  <span className="truncate text-body-sm text-muted-foreground">
                    {item.remark ??
                      `${tPage("unitPrice", { price: formatCurrency(item.unitPrice, order.currency) })}`}
                  </span>
                </span>
              }
            />
          ))}
        </PanelList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="check" title={tPage("sections.payments")} />
        <PanelList>
          {order.paymentRecords.length ? (
            order.paymentRecords.map((payment) => (
              <PanelItem
                key={payment.id}
                lead={<Icon name="check" size="sm" fallback="placeholder" />}
                main={
                  <TableTitleCell
                    title={<>{payment.paymentNo}</>}
                    description={
                      <>
                        {paySourceLabel(payment.paySource)} |{" "}
                        {t(`status.orderPayment.${payment.paymentStatus}`)} |{" "}
                        {formatDate(payment.paidAt, locale)}
                      </>
                    }
                  />
                }
                trail={
                  <span className="grid justify-items-end gap-2xs">
                    <span className="text-body-md font-semibold text-foreground">
                      {formatCurrency(payment.paidAmount, payment.currency)}
                    </span>
                    <span className="truncate text-body-sm text-muted-foreground">
                      {payment.remark ?? payment.operatorName}
                    </span>
                  </span>
                }
              />
            ))
          ) : (
            <PanelItem
              lead={<Icon name="clock" size="sm" fallback="placeholder" />}
              main={
                <TableTitleCell
                  title={<>{tPage("payments.empty")}</>}
                  description={<>{tPage("payments.emptyHint")}</>}
                />
              }
              trail={
                <span className="grid justify-items-end gap-2xs">
                  <span className="text-body-md font-semibold text-foreground">
                    {tPage("payments.unpaid")}
                  </span>
                  <span className="truncate text-body-sm text-muted-foreground">
                    {tPage("payments.unpaidHint")}
                  </span>
                </span>
              }
            />
          )}
        </PanelList>
      </section>

      <section className={`${SHELL_PANEL_HAIRLINE} grid min-w-0 gap-md pt-lg`}>
        <DetailSectionHeading icon="clock" title={tPage("sections.opsLog")} />
        <PanelList>
          {order.operationTimeline.map((event) => (
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

export function OrderDetailPage({ orderId }: { orderId: string }) {
  const locale = useLocale();
  const tPage = useTranslations("orderDetailPage");
  const tShared = useTranslations();
  const { runWithStepUp } = useStepUp();
  const [order, setOrder] = useState<OrderOperationDetailRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [submittingReject, setSubmittingReject] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [submittingVoid, setSubmittingVoid] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreReason, setRestoreReason] = useState("");
  const [submittingRestore, setSubmittingRestore] = useState(false);
  // 退款（product_330 §5）：approve / reject = 审核；execute = 已打款后执行（订单 refunded + 订阅回滚）
  const [refundDialog, setRefundDialog] = useState<
    "approve" | "reject" | "execute" | null
  >(null);
  const [refundRemark, setRefundRemark] = useState("");
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationFeedback, setOperationFeedback] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetchOrderOperation(orderId)
      .then((record) => {
        if (active) setOrder(record);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [orderId]);

  async function handleConfirmOfflinePayment(
    payload: Parameters<typeof confirmOrderOfflinePayment>[1],
  ) {
    if (!order) return;

    setSubmittingPayment(true);
    setOperationError(null);

    try {
      // Offline payment confirmation is 危 commerce:payment.settle → step-up.
      const updatedOrder = await runWithStepUp(() =>
        confirmOrderOfflinePayment(order.id, payload),
      );
      setOrder(updatedOrder);
      setOperationFeedback(tPage("feedback.paymentConfirmed"));
      setPaymentDialogOpen(false);
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : tPage("feedback.confirmPaymentFailed"),
      );
    } finally {
      setSubmittingPayment(false);
    }
  }

  async function handleRejectDeclaration() {
    if (!order) return;

    setSubmittingReject(true);
    setOperationError(null);

    try {
      // Reject shares the settle danger class (commerce:payment.settle) → step-up.
      const updatedOrder = await runWithStepUp(() =>
        rejectOrderPaymentDeclaration(order.id, rejectReason),
      );
      setOrder(updatedOrder);
      setOperationFeedback(tPage("feedback.declarationRejected"));
      setRejectDialogOpen(false);
      setRejectReason("");
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : tPage("feedback.rejectDeclarationFailed"),
      );
    } finally {
      setSubmittingReject(false);
    }
  }

  async function handleRedriveProvisioning() {
    if (!order) return;

    setSubmittingPayment(true);
    setOperationError(null);

    try {
      // Same endpoint as confirm — the backend detects the paid-but-hung order
      // and re-drives stage 2 without requiring declaration fields (P8 ③).
      const updatedOrder = await runWithStepUp(() =>
        confirmOrderOfflinePayment(order.id, {
          paidAmount: 0,
          offlinePayType: "other",
          payerName: "-",
          paidAt: new Date().toISOString(),
          reason: "manual stage-2 re-drive",
        }),
      );
      setOrder(updatedOrder);
      setOperationFeedback(tPage("feedback.provisionRetried"));
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : tPage("feedback.retryProvisionFailed"),
      );
    } finally {
      setSubmittingPayment(false);
    }
  }

  async function handleVoidOrder() {
    if (!order) return;

    setSubmittingVoid(true);
    setOperationError(null);

    try {
      // Void is 危 commerce:order.void → step-up.
      const updatedOrder = await runWithStepUp(() =>
        voidOrder(order.id, voidReason),
      );
      setOrder(updatedOrder);
      setOperationFeedback(tPage("feedback.orderRejected"));
      setVoidDialogOpen(false);
      setVoidReason("");
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : tPage("feedback.rejectOrderFailed"),
      );
    } finally {
      setSubmittingVoid(false);
    }
  }

  async function handleRefundAction() {
    if (!order || !refundDialog) return;
    setSubmittingRefund(true);
    setOperationError(null);
    try {
      const updated =
        refundDialog === "execute"
          ? await executeOrderRefund(order.id, refundRemark)
          : await auditOrderRefund(
              order.id,
              refundDialog === "approve" ? "approved" : "rejected",
              refundRemark,
            );
      setOrder(updated);
      setOperationFeedback(
        refundDialog === "execute"
          ? tPage("feedback.refundExecuted")
          : refundDialog === "approve"
            ? tPage("feedback.refundApproved")
            : tPage("feedback.refundRejected"),
      );
      setRefundDialog(null);
      setRefundRemark("");
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : tPage("feedback.refundFailed"),
      );
    } finally {
      setSubmittingRefund(false);
    }
  }

  async function handleRestoreOrder() {
    if (!order) return;

    setSubmittingRestore(true);
    setOperationError(null);

    try {
      // Restore is 危 commerce:order.restore → step-up.
      const updatedOrder = await runWithStepUp(() =>
        restoreOrder(order.id, restoreReason),
      );
      setOrder(updatedOrder);
      setOperationFeedback(tPage("feedback.orderRestored"));
      setRestoreDialogOpen(false);
      setRestoreReason("");
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : tPage("feedback.restoreFailed"),
      );
    } finally {
      setSubmittingRestore(false);
    }
  }

  if (!loading && !order) {
    return (
      <DetailPageTemplate
        className="min-w-0"
        header={
          <PageHeader
            icon="table"
            title={tPage("title")}
            description={tPage("notFound.description")}
            action={
              <Button asChild variant="outline">
                <Link href="/orders">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
            }
          />
        }
      >
        <EmptyState
          title={tPage("noAccess.title")}
          description={tPage("noAccess.description")}
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="min-w-0 vx-order-detail-page"
      header={
        <PageHeader
          icon="table"
          title={order ? order.orderNo : tPage("title")}
          description={
            order
              ? `${order.tenantName} · ${order.solutionName} · ${order.servicePlanName}`
              : tPage("loading")
          }
          action={
            <div className="inline-flex flex-wrap items-center justify-end gap-sm">
              <Button asChild variant="outline">
                <Link href="/orders">
                  <Icon name="arrow-left" size="xs" fallback="placeholder" />
                  {tShared("actions.backToList")}
                </Link>
              </Button>
              {order ? (
                <>
                  <Button asChild variant="outline">
                    <Link
                      href={`/subscriptions/${encodeURIComponent(order.orderNo)}`}
                    >
                      <Icon name="star" size="xs" fallback="placeholder" />
                      {tPage("links.subscription")}
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setOperationError(null);
                      setOperationFeedback(null);
                      setPaymentDialogOpen(true);
                    }}
                    disabled={!canConfirmOrderOfflinePayment(order)}
                    title={
                      confirmOfflinePaymentDisabledReason(order) ?? undefined
                    }
                  >
                    <Icon name="check" size="xs" fallback="placeholder" />
                    {tPage("actions.confirmPayment")}
                  </Button>
                  {order.declaredPayment ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOperationError(null);
                        setOperationFeedback(null);
                        setRejectReason("");
                        setRejectDialogOpen(true);
                      }}
                    >
                      <Icon name="warning" size="xs" fallback="placeholder" />
                      {tPage("actions.rejectDeclaration")}
                    </Button>
                  ) : null}
                  {order.orderStatus === "paid_unprovisioned" ? (
                    <Button
                      variant="outline"
                      onClick={handleRedriveProvisioning}
                      disabled={submittingPayment}
                    >
                      <Icon name="play" size="xs" fallback="placeholder" />
                      {tPage("actions.retryProvision")}
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setOperationError(null);
                      setOperationFeedback(null);
                      setVoidReason("");
                      setVoidDialogOpen(true);
                    }}
                    disabled={!canVoidOrder(order)}
                    title={voidDisabledReason(order, tPage) ?? undefined}
                  >
                    <Icon name="x" size="xs" fallback="placeholder" />
                    {tPage("actions.rejectOrder")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setOperationError(null);
                      setOperationFeedback(null);
                      setRestoreReason("");
                      setRestoreDialogOpen(true);
                    }}
                    disabled={!order.restorable}
                    title={restoreDisabledReason(order, tPage) ?? undefined}
                  >
                    <Icon name="play" size="xs" fallback="placeholder" />
                    {tPage("actions.restoreOrder")}
                  </Button>
                  {order.refund && order.refund.auditStatus === "pending" ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setOperationError(null);
                          setOperationFeedback(null);
                          setRefundRemark("");
                          setRefundDialog("approve");
                        }}
                      >
                        <Icon name="check" size="xs" fallback="placeholder" />
                        {tPage("actions.approveRefund")}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setOperationError(null);
                          setOperationFeedback(null);
                          setRefundRemark("");
                          setRefundDialog("reject");
                        }}
                      >
                        <Icon name="x" size="xs" fallback="placeholder" />
                        {tPage("actions.rejectRefund")}
                      </Button>
                    </>
                  ) : null}
                  {order.refund &&
                  order.refund.auditStatus === "approved" &&
                  order.refund.refundStatus !== "success" ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOperationError(null);
                        setOperationFeedback(null);
                        setRefundRemark("");
                        setRefundDialog("execute");
                      }}
                    >
                      <Icon name="check" size="xs" fallback="placeholder" />
                      {tPage("actions.completeRefund")}
                    </Button>
                  ) : null}
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

      {/*
       * 页头动作（「重试开通」）不开对话框，失败时 operationError 此前只在五个
       * 对话框内部渲染 —— 报错等于没报：2026-09-07 生产上运营点「重试开通」、
       * TOTP 过了、后端报错了，界面上什么都没有。错误必须有页面级落脚处。
       */}
      {!paymentDialogOpen &&
      !rejectDialogOpen &&
      !voidDialogOpen &&
      !restoreDialogOpen &&
      !refundDialog &&
      operationError ? (
        <div
          className="inline-flex w-fit items-center rounded-lg px-sm py-xs text-body-sm font-semibold text-destructive-text"
          role="alert"
        >
          {operationError}
        </div>
      ) : null}

      {order ? (
        <>
          {order.declaredPayment ? (
            <section className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
              <DetailSectionHeading
                icon="clock"
                title={tPage("declaration.title")}
              />
              <p className="m-0 text-body-sm text-muted-foreground">
                {tPage("declaration.hint")}
              </p>
              <div className="vx-detail-grid">
                <div>
                  <Label>{tPage("declaration.amount")}</Label>
                  <p>
                    {formatCurrency(
                      order.declaredPayment.amount,
                      order.currency,
                    )}
                  </p>
                </div>
                <div>
                  <Label>{tPage("declaration.channel")}</Label>
                  <p>
                    {(() => {
                      const code = order.declaredPayment.channel;
                      if (!code) return tPage("declaration.notFilled");
                      const key = DECLARED_CHANNEL_KEYS[code];
                      // 未登记的渠道码原样显示——它是 DB 里的值，不是文案，
                      // 编一个「其他」会把运营能拿去查的那个码藏掉。
                      return key ? tPage(key) : code;
                    })()}
                  </p>
                </div>
                <div>
                  <Label>{tPage("declaration.payer")}</Label>
                  <p>
                    {order.declaredPayment.payerName ??
                      tPage("declaration.notFilled")}
                  </p>
                </div>
                <div>
                  <Label>{tPage("declaration.txnNo")}</Label>
                  <p>
                    {order.declaredPayment.transactionNo ??
                      tPage("declaration.notFilled")}
                  </p>
                </div>
                <div>
                  <Label>{tPage("declaration.declaredAt")}</Label>
                  <p>{formatDate(order.declaredPayment.declaredAt, locale)}</p>
                </div>
                <div>
                  <Label>{tPage("declaration.remark")}</Label>
                  <p>
                    {order.declaredPayment.remark ?? tShared("common.none")}
                  </p>
                </div>
              </div>
            </section>
          ) : null}
          <OrderSummary order={order} />
          <OrderDetails order={order} />
        </>
      ) : (
        <section className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
          <span>{tShared("common.loading")}</span>
        </section>
      )}

      {order && paymentDialogOpen ? (
        <OrderOfflinePaymentDialog
          order={order}
          busy={submittingPayment}
          error={operationError}
          onCancel={() => {
            if (!submittingPayment) setPaymentDialogOpen(false);
          }}
          onSubmit={handleConfirmOfflinePayment}
        />
      ) : null}

      {order && rejectDialogOpen ? (
        <DialogForm
          open
          title={tPage("dialogs.rejectDeclaration.title")}
          description={
            order.declaredPayment
              ? tPage.rich("dialogs.rejectDeclaration.descriptionWithAmount", {
                  orderNo: order.orderNo,
                  amount: formatCurrency(
                    order.declaredPayment.amount,
                    order.currency,
                  ),
                  b: (chunks) => <strong>{chunks}</strong>,
                })
              : tPage.rich("dialogs.rejectDeclaration.description", {
                  orderNo: order.orderNo,
                  b: (chunks) => <strong>{chunks}</strong>,
                })
          }
          submitLabel={tPage("dialogs.rejectDeclaration.submitLabel")}
          cancelLabel={tShared("actions.cancel")}
          submitting={submittingReject}
          submitDisabled={rejectReason.trim().length < 4}
          onOpenChange={(open) => {
            if (!open && !submittingReject) setRejectDialogOpen(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleRejectDeclaration();
          }}
        >
          <Label htmlFor="order-reject-reason">
            {tPage("dialogs.rejectDeclaration.reasonLabel")}{" "}
            <small>{tPage("dialogs.rejectDeclaration.reasonHint")}</small>
          </Label>
          <Textarea
            id="order-reject-reason"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder={tPage("dialogs.rejectDeclaration.placeholder")}
            maxLength={512}
            rows={3}
            autoFocus
          />
          {operationError ? (
            <p className="text-sm text-vx-danger">{operationError}</p>
          ) : null}
        </DialogForm>
      ) : null}

      {order && order.refund && refundDialog ? (
        <DialogForm
          open
          title={
            refundDialog === "approve"
              ? tPage("dialogs.refund.titleApprove")
              : refundDialog === "reject"
                ? tPage("dialogs.refund.titleReject")
                : tPage("dialogs.refund.titleComplete")
          }
          description={tPage.rich(
            `dialogs.refund.desc${
              refundDialog === "execute"
                ? "Complete"
                : refundDialog === "approve"
                  ? "Approve"
                  : "Reject"
            }${order.refund.reason ? "WithReason" : ""}`,
            {
              refundNo: order.refund.refundNo,
              amount: formatCurrency(order.refund.amount, order.currency),
              ...(order.refund.reason ? { reason: order.refund.reason } : {}),
              b: (chunks) => <strong>{chunks}</strong>,
            },
          )}
          submitLabel={
            refundDialog === "approve"
              ? tPage("dialogs.refund.submitApprove")
              : refundDialog === "reject"
                ? tPage("dialogs.refund.submitReject")
                : tPage("dialogs.refund.submitComplete")
          }
          cancelLabel={tShared("actions.cancel")}
          submitting={submittingRefund}
          submitDisabled={refundRemark.trim().length < 4}
          onOpenChange={(open) => {
            if (!open && !submittingRefund) setRefundDialog(null);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleRefundAction();
          }}
        >
          <Label htmlFor="vx-order-refund-remark">
            {tPage("dialogs.refund.remarkLabel")}{" "}
            <small>
              {refundDialog === "reject"
                ? tPage("dialogs.refund.remarkHintCustomer")
                : tPage("dialogs.refund.remarkHint")}
            </small>
          </Label>
          <Textarea
            id="vx-order-refund-remark"
            value={refundRemark}
            onChange={(event) => setRefundRemark(event.target.value)}
            placeholder={
              refundDialog === "execute"
                ? tPage("dialogs.refund.placeholderComplete")
                : tPage("dialogs.refund.placeholderReview")
            }
            maxLength={512}
            rows={3}
            autoFocus
          />
          {operationError ? (
            <p className="text-sm text-vx-danger">{operationError}</p>
          ) : null}
        </DialogForm>
      ) : null}

      {order && voidDialogOpen ? (
        <DialogForm
          open
          title={tPage("dialogs.rejectOrder.title")}
          description={
            order.tenantName
              ? tPage.rich("dialogs.rejectOrder.descriptionWithTenant", {
                  orderNo: order.orderNo,
                  tenantName: order.tenantName,
                  b: (chunks) => <strong>{chunks}</strong>,
                })
              : tPage.rich("dialogs.rejectOrder.description", {
                  orderNo: order.orderNo,
                  b: (chunks) => <strong>{chunks}</strong>,
                })
          }
          submitLabel={tPage("dialogs.rejectOrder.submitLabel")}
          cancelLabel={tShared("actions.cancel")}
          submitting={submittingVoid}
          submitDisabled={voidReason.trim().length < 4}
          onOpenChange={(open) => {
            if (!open && !submittingVoid) setVoidDialogOpen(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleVoidOrder();
          }}
        >
          <Label htmlFor="vx-order-void-reason">
            {tPage("dialogs.rejectOrder.reasonLabel")}{" "}
            <small>{tPage("dialogs.rejectOrder.reasonHint")}</small>
          </Label>
          <Textarea
            id="vx-order-void-reason"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={3}
            placeholder={tPage("dialogs.rejectOrder.placeholder")}
            autoFocus
          />
          {operationError ? (
            <p className="text-sm text-vx-danger">{operationError}</p>
          ) : null}
        </DialogForm>
      ) : null}

      {order && restoreDialogOpen ? (
        <DialogForm
          open
          title={tPage("dialogs.restoreOrder.title")}
          description={
            order.tenantName
              ? tPage.rich("dialogs.restoreOrder.descriptionWithTenant", {
                  orderNo: order.orderNo,
                  tenantName: order.tenantName,
                  b: (chunks) => <strong>{chunks}</strong>,
                })
              : tPage.rich("dialogs.restoreOrder.description", {
                  orderNo: order.orderNo,
                  b: (chunks) => <strong>{chunks}</strong>,
                })
          }
          submitLabel={tPage("dialogs.restoreOrder.submitLabel")}
          cancelLabel={tShared("actions.cancel")}
          submitting={submittingRestore}
          submitDisabled={restoreReason.trim().length < 4}
          onOpenChange={(open) => {
            if (!open && !submittingRestore) setRestoreDialogOpen(false);
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleRestoreOrder();
          }}
        >
          <Label htmlFor="vx-order-restore-reason">
            {tPage("dialogs.restoreOrder.reasonLabel")}{" "}
            <small>{tPage("dialogs.restoreOrder.reasonHint")}</small>
          </Label>
          <Textarea
            id="vx-order-restore-reason"
            value={restoreReason}
            onChange={(e) => setRestoreReason(e.target.value)}
            rows={3}
            placeholder={tPage("dialogs.restoreOrder.placeholder")}
            autoFocus
          />
          {operationError ? (
            <p className="text-sm text-vx-danger">{operationError}</p>
          ) : null}
        </DialogForm>
      ) : null}
    </DetailPageTemplate>
  );
}
