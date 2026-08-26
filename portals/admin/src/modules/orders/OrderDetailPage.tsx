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
  StatusBadge,
  Textarea,
} from "@vxture/design-system";
import { orUnset } from "@/modules/shared/display";
import {
  confirmOrderOfflinePayment,
  fetchOrderOperation,
  rejectOrderPaymentDeclaration,
  restoreOrder,
  voidOrder,
} from "@/api/admin-bff";
import type {
  OrderOperationDetailRecord,
  OrderOperationStatus,
  OrderPaySource,
} from "@/entities/console";
import {
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_TONE,
} from "@/modules/shared/status-tone";
import { PageHeader } from "@/modules/shared/PageHeader";
import { DetailSectionHeading } from "@/modules/shared/DetailSectionHeading";
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

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

function cycleLabel(cycle: OrderOperationDetailRecord["cycleType"]) {
  if (cycle === "yearly") return "年付";
  if (cycle === "once") return "一次性";
  return "月付";
}

function orderStatusLabel(status: OrderOperationStatus) {
  if (status === "pending") return "待付款";
  if (status === "pending_verify") return "待复核";
  if (status === "confirmed") return "已确认";
  if (status === "overdue") return "逾期";
  if (status === "closed") return "已关闭";
  if (status === "paid_unprovisioned") return "已付未开通";
  if (status === "partial_pending") return "部分收款·挂账";
  return "异常";
}

function paySourceLabel(source: OrderPaySource) {
  if (source === "online") return "线上";
  if (source === "offline") return "线下";
  if (source === "voucher") return "券";
  return "无";
}

const DECLARED_CHANNEL_LABELS: Record<string, string> = {
  alipay: "支付宝",
  bank: "银行转账",
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

function voidDisabledReason(order: OrderOperationDetailRecord) {
  if (canVoidOrder(order)) return null;
  if (order.paidAmount > 0) return "已收到支付的订单不能驳回，请走结算流程。";
  return "该订单不是待支付状态，无需驳回。";
}

// restorable 由后端判定：从未激活过（订阅 end_at 为空）且没有支付记录的
// 已取消/已过期订单才可恢复；已激活后再取消的订阅不在此列（见 admin-bff）。
function restoreDisabledReason(order: OrderOperationDetailRecord) {
  if (order.restorable) return null;
  return "该订单不是可恢复的已取消状态（已激活过的订阅取消后无法在此恢复）。";
}

function subscriptionStatusLabel(
  status: OrderOperationDetailRecord["subscriptionStatus"],
) {
  if (status === "trialing") return "试用";
  if (status === "active") return "已生效";
  if (status === "expiring") return "即将到期";
  if (status === "overdue") return "逾期";
  if (status === "suspended") return "暂停";
  return "已取消";
}

function OrderSummary({ order }: { order: OrderOperationDetailRecord }) {
  const t = useTranslations();
  const tShared = useTranslations();
  return (
    <section className="vx-product-capability-summary">
      <div className="vx-product-capability-summary__identity">
        <span
          className="vx-product-capability-summary__icon"
          aria-hidden="true"
        >
          <Icon name="table" size="lg" fallback="placeholder" />
        </span>
        <div>
          <h2>{order.orderNo}</h2>
          <p>
            {order.tenantName} / {order.tierName}
          </p>
          <div className="vx-product-capability-summary__badges">
            <StatusBadge tone={ORDER_STATUS_TONE[order.orderStatus]}>
              {orderStatusLabel(order.orderStatus)}
            </StatusBadge>
            <StatusBadge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>
              {t(`status.orderPayment.${order.paymentStatus}`)}
            </StatusBadge>
          </div>
        </div>
      </div>
      <MetricGrid
        items={[
          {
            id: "amount",
            help: "订单成交金额，按订单币种展示。",
            label: "订单金额",
            value: formatCurrency(order.amount, order.currency),
            tags: [cycleLabel(order.cycleType)],
          },
          {
            id: "paid",
            help: "已核销到本订单的回款金额。",
            label: tShared("columns.receivedAmount"),
            value: formatCurrency(order.paidAmount, order.currency),
            tags: [paySourceLabel(order.paySource)],
          },
          {
            id: "solution",
            help: "本订单开通的业务方案。",
            label: "业务方案",
            value: order.solutionName,
            tags: [order.servicePlanName],
          },
          {
            id: "operation",
            help: "按当前订单状态给出的建议处理动作。",
            label: "运营动作",
            value: order.operationHint,
            tags: [order.operatorName],
          },
        ]}
      />
    </section>
  );
}

function OrderDetails({ order }: { order: OrderOperationDetailRecord }) {
  const t = useTranslations();
  const locale = useLocale();
  const tShared = useTranslations();
  return (
    <section
      className="vx-product-capability-detail"
      aria-label={`${order.orderNo} 订单详情`}
    >
      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="table" title="基础资料" />
        <DetailList columns={3}>
          <DetailRow label="订单编号">{orUnset(order.orderNo)}</DetailRow>
          <DetailRow label="订单状态">
            {orUnset(orderStatusLabel(order.orderStatus))}
          </DetailRow>
          <DetailRow label="支付状态">
            {orUnset(t(`status.orderPayment.${order.paymentStatus}`))}
          </DetailRow>
          <DetailRow label="支付来源">
            {orUnset(paySourceLabel(order.paySource))}
          </DetailRow>
          <DetailRow label="支付方式">{orUnset(order.payMethod)}</DetailRow>
          <DetailRow label="创建时间">
            {orUnset(formatDate(order.createdAt, locale))}
          </DetailRow>
          <DetailRow label="确认时间">
            {orUnset(formatDate(order.confirmedAt, locale))}
          </DetailRow>
          <DetailRow label={tShared("columns.updatedAt")}>
            {orUnset(formatDate(order.updatedAt, locale))}
          </DetailRow>
        </DetailList>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="buildings" title="租户与套餐" />
        <DetailList columns={3}>
          <DetailRow label="租户">{orUnset(order.tenantName)}</DetailRow>
          <DetailRow label={tShared("columns.tenantCode")}>
            {orUnset(order.tenantCode)}
          </DetailRow>
          <DetailRow label={tShared("columns.tenantType")}>
            {orUnset(typeLabel(order.tenantType))}
          </DetailRow>
          <DetailRow label="所属区域">{orUnset(order.region)}</DetailRow>
          <DetailRow label="所属行业">{orUnset(order.industry)}</DetailRow>
          <DetailRow label="业务方案">{orUnset(order.solutionName)}</DetailRow>
          <DetailRow label="服务套餐">
            {orUnset(order.servicePlanName)}
          </DetailRow>
          <DetailRow label="套餐层级">{orUnset(order.tierName)}</DetailRow>
        </DetailList>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="star" title="关联订阅" />
        <DetailList columns={3}>
          <DetailRow label="订阅 ID">{orUnset(order.subscriptionId)}</DetailRow>
          <DetailRow label="订阅状态">
            {orUnset(subscriptionStatusLabel(order.subscriptionStatus))}
          </DetailRow>
          <DetailRow label="计费周期">
            {orUnset(cycleLabel(order.cycleType))}
          </DetailRow>
        </DetailList>
        <div className="vx-product-capability-actions vx-subscription-detail-links">
          <Button asChild variant="outline">
            <Link
              href={`/subscriptions/${encodeURIComponent(order.subscriptionId)}`}
            >
              <Icon name="star" size="xs" fallback="placeholder" />
              订阅详情
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/tenants/${encodeURIComponent(order.tenantId)}`}>
              <Icon name="buildings" size="xs" fallback="placeholder" />
              租户详情
            </Link>
          </Button>
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="key" title="账单与收款" />
        <DetailList columns={3}>
          <DetailRow label="账单编号">{order.billNo || "未生成"}</DetailRow>
          <DetailRow label="账单状态">{order.billStatus || "未生成"}</DetailRow>
          <DetailRow label="支付单号">{order.paymentNo || "未生成"}</DetailRow>
          <DetailRow label="订单金额">
            {orUnset(formatCurrency(order.amount, order.currency))}
          </DetailRow>
          <DetailRow label={tShared("columns.receivedAmount")}>
            {orUnset(formatCurrency(order.paidAmount, order.currency))}
          </DetailRow>
          <DetailRow label="剩余应收">
            {orUnset(
              formatCurrency(
                Math.max(0, order.amount - order.paidAmount),
                order.currency,
              ),
            )}
          </DetailRow>
        </DetailList>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="list" title="账单明细" />
        <div className="vx-product-detail-list vx-product-detail-list--entitlements">
          {order.invoiceItems.map((item) => (
            <div key={item.id} className="vx-product-detail-list__row">
              <span>
                <Icon name="table" size="sm" fallback="placeholder" />
                <strong>{item.itemName}</strong>
              </span>
              <small>
                {item.itemType} | {formatQuantity(item.quantity)}{" "}
                {item.itemUnit ?? ""}
              </small>
              <em>{formatCurrency(item.totalAmount, order.currency)}</em>
              <p>
                {item.remark ??
                  `单价 ${formatCurrency(item.unitPrice, order.currency)}`}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="check" title="支付记录" />
        <div className="vx-product-detail-list vx-product-detail-list--entitlements">
          {order.paymentRecords.length ? (
            order.paymentRecords.map((payment) => (
              <div key={payment.id} className="vx-product-detail-list__row">
                <span>
                  <Icon name="check" size="sm" fallback="placeholder" />
                  <strong>{payment.paymentNo}</strong>
                </span>
                <small>
                  {paySourceLabel(payment.paySource)} |{" "}
                  {t(`status.orderPayment.${payment.paymentStatus}`)} |{" "}
                  {formatDate(payment.paidAt, locale)}
                </small>
                <em>{formatCurrency(payment.paidAmount, payment.currency)}</em>
                <p>{payment.remark ?? payment.operatorName}</p>
              </div>
            ))
          ) : (
            <div className="vx-product-detail-list__row">
              <span>
                <Icon name="clock" size="sm" fallback="placeholder" />
                <strong>暂无支付记录</strong>
              </span>
              <small>等待线上支付或运营确认线下收款</small>
              <em>未收款</em>
              <p>确认线下收款后会自动写入支付记录。</p>
            </div>
          )}
        </div>
      </section>

      <section className="vx-product-capability-section">
        <DetailSectionHeading icon="clock" title="运营记录" />
        <div className="vx-subscription-timeline">
          {order.operationTimeline.map((event) => (
            <article
              key={event.id}
              className={`vx-subscription-timeline__item vx-subscription-timeline__item--${event.tone}`}
            >
              <span aria-hidden="true">
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
              <div>
                <strong>{event.title}</strong>
                <p>{event.description}</p>
                <small>
                  {event.actor} · {formatDate(event.at, locale)}
                </small>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

export function OrderDetailPage({ orderId }: { orderId: string }) {
  const locale = useLocale();
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
      setOperationFeedback("线下收款已确认。");
      setPaymentDialogOpen(false);
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : "确认线下收款失败，请稍后重试。",
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
      setOperationFeedback(
        "付款申报已驳回，券与折扣已释放，客户端将看到驳回原因。",
      );
      setRejectDialogOpen(false);
      setRejectReason("");
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error
          ? error.message
          : "驳回付款申报失败，请稍后重试。",
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
      setOperationFeedback("已重试开通（段 2 重驱动）。");
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error ? error.message : "重试开通失败，请稍后重试。",
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
      setOperationFeedback("订单已驳回。");
      setVoidDialogOpen(false);
      setVoidReason("");
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error ? error.message : "驳回订单失败，请稍后重试。",
      );
    } finally {
      setSubmittingVoid(false);
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
      setOperationFeedback("订单已恢复为待支付状态。");
      setRestoreDialogOpen(false);
      setRestoreReason("");
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error ? error.message : "恢复订单失败，请稍后重试。",
      );
    } finally {
      setSubmittingRestore(false);
    }
  }

  if (!loading && !order) {
    return (
      <DetailPageTemplate
        className="vx-product-capability-page"
        header={
          <PageHeader
            icon="table"
            title="订单详情"
            description="未找到对应的订单记录。"
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
          title="订单不存在"
          description="该订单可能已归档，或当前账号无权访问。"
        />
      </DetailPageTemplate>
    );
  }

  return (
    <DetailPageTemplate
      className="vx-product-capability-page vx-order-detail-page"
      header={
        <PageHeader
          icon="table"
          title={order ? order.orderNo : "订单详情"}
          description={
            order
              ? `${order.tenantName} · ${order.solutionName} · ${order.servicePlanName}`
              : "正在读取订单、账单和支付记录。"
          }
          action={
            <div className="vx-product-capability-actions">
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
                      href={`/subscriptions/${encodeURIComponent(order.subscriptionId)}`}
                    >
                      <Icon name="star" size="xs" fallback="placeholder" />
                      订阅详情
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
                    确认收款
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
                      驳回申报
                    </Button>
                  ) : null}
                  {order.orderStatus === "paid_unprovisioned" ? (
                    <Button
                      variant="outline"
                      onClick={handleRedriveProvisioning}
                      disabled={submittingPayment}
                    >
                      <Icon name="play" size="xs" fallback="placeholder" />
                      重试开通
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
                    title={voidDisabledReason(order) ?? undefined}
                  >
                    <Icon name="x" size="xs" fallback="placeholder" />
                    驳回订单
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
                    title={restoreDisabledReason(order) ?? undefined}
                  >
                    <Icon name="play" size="xs" fallback="placeholder" />
                    恢复订单
                  </Button>
                </>
              ) : null}
            </div>
          }
        />
      }
    >
      {operationFeedback ? (
        <div className="vx-subscription-operation-feedback">
          {operationFeedback}
        </div>
      ) : null}

      {order ? (
        <>
          {order.declaredPayment ? (
            <section className="flex min-h-0 items-center justify-end gap-sm text-body-sm font-normal text-muted-foreground">
              <DetailSectionHeading icon="clock" title="客户付款申报" />
              <p className="vx-subscription-action-dialog__description">
                客户在付款页提交的申报信息，确认前请核对到账；实收不符请「驳回申报」。
              </p>
              <div className="vx-detail-grid">
                <div>
                  <Label>申报金额</Label>
                  <p>
                    {formatCurrency(
                      order.declaredPayment.amount,
                      order.currency,
                    )}
                  </p>
                </div>
                <div>
                  <Label>支付渠道</Label>
                  <p>
                    {DECLARED_CHANNEL_LABELS[
                      order.declaredPayment.channel ?? ""
                    ] ??
                      order.declaredPayment.channel ??
                      "未填写"}
                  </p>
                </div>
                <div>
                  <Label>付款方</Label>
                  <p>{order.declaredPayment.payerName ?? "未填写"}</p>
                </div>
                <div>
                  <Label>流水号</Label>
                  <p>{order.declaredPayment.transactionNo ?? "未填写"}</p>
                </div>
                <div>
                  <Label>申报时间</Label>
                  <p>{formatDate(order.declaredPayment.declaredAt, locale)}</p>
                </div>
                <div>
                  <Label>备注</Label>
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
          title="驳回付款申报"
          description={
            <>
              订单号：<strong>{order.orderNo}</strong>
              {order.declaredPayment
                ? ` · 申报 ${formatCurrency(order.declaredPayment.amount, order.currency)}`
                : ""}
              。驳回后券与折扣自动释放，订单回到待付款，驳回原因将展示在客户付款页。
            </>
          }
          submitLabel="确认驳回申报"
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
            驳回原因 <small>（必填，最少 4 字；将展示给客户）</small>
          </Label>
          <Textarea
            id="order-reject-reason"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="例如：未查到对应转账记录，请核对金额后重新付款；实收 500 与申报 860 不符。"
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
          title="驳回订单"
          description={
            <>
              订单号：<strong>{order.orderNo}</strong>
              {order.tenantName ? `  ·  ${order.tenantName}` : ""}
            </>
          }
          submitLabel="确认驳回"
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
            驳回原因 <small>（必填，最少 4 字）</small>
          </Label>
          <Textarea
            id="vx-order-void-reason"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={3}
            placeholder="例如：客户电话取消，重复下单。"
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
          title="恢复订单"
          description={
            <>
              订单号：<strong>{order.orderNo}</strong>
              {order.tenantName ? `  ·  ${order.tenantName}` : ""}
              。恢复后订单回到待付款状态，账单与折扣一并复原。
            </>
          }
          submitLabel="确认恢复"
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
            恢复原因 <small>（必填，最少 4 字）</small>
          </Label>
          <Textarea
            id="vx-order-restore-reason"
            value={restoreReason}
            onChange={(e) => setRestoreReason(e.target.value)}
            rows={3}
            placeholder="例如：客户已确认继续购买，误操作驳回，现恢复订单。"
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
