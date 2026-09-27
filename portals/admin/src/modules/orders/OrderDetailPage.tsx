"use client";

/**
 * OrderDetailPage.tsx — 交易订单详情（运营 / 客服视角）。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Orders
 *
 * 2026-09-27 按设计稿重排（scratchpad/order-detail-redesign.md §3 / §3.8 / §5）。
 * 整页只回答三件事：这是什么单、现在卡在哪一步、我该做什么——
 *   页头（是什么单）→ 任务卡（卡在哪、做什么：五步进度 + 一句任务 + 主按钮）
 *   → 左栏（客户申报 / 金额构成 / 时间线）+ 右栏（订单信息 / 租户与联系人 / 开通后 / 退款）。
 *
 * 拿掉的：四张带柱状图的统计卡、重复的卡片头、原始 JSON / 枚举 / UUID、「未设置」占位
 * （真没填写「客户未填」，这一步没到就整块不显示）、手写的反馈 div（改 DS Banner + toast）。
 *
 * 动作与接口一个没动（确认 / 驳回 / 作废 / 恢复 / 退款审核-执行-失败），只补了一处
 * 已知缺陷：退款四个动作的端点都 @RequireStepUp，页面此前直接调用不走 runWithStepUp。
 */

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ActionMenu,
  Banner,
  Button,
  DetailList,
  DetailPageTemplate,
  DetailRow,
  DialogForm,
  EmptyState,
  FactList,
  Field,
  FieldError,
  FieldLabel,
  Icon,
  PanelItem,
  PanelList,
  Section,
  SectionHeader,
  StatusBadge,
  TableTitleCell,
  Textarea,
  toneSurfaceClasses,
  useToast,
  ViewHeader,
} from "@vxture/design-system";
import type { ActionMenuItem, StatusBadgeTone } from "@vxture/design-system";
import {
  formatClock,
  formatDay,
  formatPrincipalNoOr,
} from "@vxture-platform/shared";
import {
  auditOrderRefund,
  confirmOrderOfflinePayment,
  createOrderRefund,
  executeOrderRefund,
  failOrderRefund,
  fetchOrderOperation,
  rejectOrderPaymentDeclaration,
  restoreOrder,
  voidOrder,
} from "@/api/admin-bff";
import type {
  OrderOperationDetailRecord,
  OrderOperationEvent,
} from "@/entities/console";
import { isUnset } from "@/modules/shared/display";
import {
  usePaySourceLabel,
  useSubscriptionCycleLabels,
  useSubscriptionStatusLabels,
} from "@/modules/shared/enum-labels";
import { typeLabel } from "@/modules/tenants/tenant-utils";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";
import {
  canConfirmOrderOfflinePayment,
  confirmOfflinePaymentDisabledReasonKey,
  OrderOfflinePaymentDialog,
} from "@/modules/orders/OrderOfflinePaymentDialog";
import { formatOrderAmount } from "@/modules/orders/order-format";
import {
  ORDER_STATUS_HINT_KEY,
  ORDER_STATUS_LABEL_KEY,
  ORDER_STATUS_TONE_MAP,
  orderStagePlan,
} from "@/modules/orders/order-status";
import { OrderStageStrip } from "@/modules/orders/components/OrderStageStrip";

/** 本页命名空间的取词函数类型。模块级函数收它当参数（组件外拿不到 hook）。 */
type TPage = ReturnType<typeof useTranslations<"orderDetailPage">>;

type Order = OrderOperationDetailRecord;

type RefundDialogMode = "approve" | "reject" | "execute" | "fail" | "create";

// ── 判定 ─────────────────────────────────────────────────────────────────────

// 仅真正的待支付订单可作废——已有任何收款请走结算而非作废（product_320 §4.3）。
// product_321 P2：已申报（pending_verify）订单须先「驳回申报」再作废。
function canVoidOrder(order: Order) {
  return (
    order.orderStatus === "pending" &&
    order.paidAmount <= 0 &&
    !order.declaredPayment
  );
}

function voidDisabledReason(order: Order, tPage: TPage) {
  if (canVoidOrder(order)) return null;
  if (order.paidAmount > 0) return tPage("disabled.hasPayment");
  if (order.declaredPayment) return tPage("disabled.declaredFirst");
  return tPage("disabled.notPending");
}

// restorable 由后端判定：从未激活过（订阅 end_at 为空）且没有支付记录的
// 已取消/已过期订单才可恢复；已激活后再取消的订阅不在此列（见 admin-bff）。
function restoreDisabledReason(order: Order, tPage: TPage) {
  if (order.restorable) return null;
  return tPage("disabled.notRestorable");
}

function confirmDisabledReason(order: Order, tPage: TPage) {
  const key = confirmOfflinePaymentDisabledReasonKey(order);
  if (key === "free") return tPage("disabled.confirm.free");
  if (key === "done") return tPage("disabled.confirm.done");
  if (key === "closed") return tPage("disabled.confirm.closed");
  if (key === "refunding") return tPage("disabled.confirm.refunding");
  return null;
}

/** 退款是否还在走（有单、没驳回、没打款成功）。有则任务卡与进度条都以它为准。 */
function refundInFlight(order: Order) {
  const refund = order.refund ?? null;
  if (!refund) return null;
  if (refund.auditStatus === "rejected") return null;
  if (refund.refundStatus === "success" || order.orderStatus === "refunded")
    return null;
  return refund;
}

// ── 小工具 ─────────────────────────────────────────────────────────────────

/**
 * 当前时刻，每分钟刷新一次，给倒计时与「等了多久」用。
 * 首次渲染给 null：服务端与浏览器的 Date.now() 不一样，直接用会 hydration 不一致。
 */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatDuration(ms: number, tPage: TPage) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return tPage("duration.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return tPage("duration.hours", { hours, minutes: minutes % 60 });
  const days = Math.floor(hours / 24);
  return tPage("duration.days", { days, hours: hours % 24 });
}

function dayAndClock(value: string | null, locale: string) {
  if (!value) return "—";
  return `${formatDay(value, locale, "—")} ${formatClock(value, locale, "")}`.trim();
}

/** 申报渠道码 → 人话。未登记的码不直出（那是机器词），归到「其他渠道」。 */
function channelLabel(channel: string | null, tPage: TPage) {
  if (channel === "alipay") return tPage("channels.alipay");
  if (channel === "bank") return tPage("channels.bank");
  if (!channel) return tPage("declaration.notFilled");
  return tPage("channels.other");
}

function intentLabel(intent: Order["intent"], tPage: TPage) {
  if (intent === "upgrade") return tPage("intent.upgrade");
  if (intent === "renew") return tPage("intent.renew");
  return tPage("intent.new");
}

function closeReasonLabel(reason: string | null, tPage: TPage) {
  switch (reason) {
    case "customer_cancel":
      return tPage("closeReason.customer_cancel");
    case "operator_void":
      return tPage("closeReason.operator_void");
    case "ttl_expired":
      return tPage("closeReason.ttl_expired");
    case "refunded":
      return tPage("closeReason.refunded");
    case "backfill":
      return tPage("closeReason.backfill");
    default:
      return tPage("closeReason.other");
  }
}

function invoiceItemTypeLabel(itemType: string, tPage: TPage) {
  switch (itemType) {
    case "subscription_fee":
      return tPage("invoiceItemTypes.subscription_fee");
    case "discount":
      return tPage("invoiceItemTypes.discount");
    case "credit_adjustment":
      return tPage("invoiceItemTypes.credit_adjustment");
    case "voucher":
      return tPage("invoiceItemTypes.voucher");
    case "addon":
      return tPage("invoiceItemTypes.addon");
    case "usage":
      return tPage("invoiceItemTypes.usage");
    case "adjustment":
      return tPage("invoiceItemTypes.adjustment");
    default:
      return tPage("invoiceItemTypes.other");
  }
}

function refundAuditLabel(
  status: "pending" | "approved" | "rejected",
  tPage: TPage,
) {
  if (status === "approved") return tPage("refund.audit.approved");
  if (status === "rejected") return tPage("refund.audit.rejected");
  return tPage("refund.audit.pending");
}

function refundStatusLabel(
  status: "pending" | "processing" | "success" | "failed",
  tPage: TPage,
) {
  if (status === "success") return tPage("refund.status.success");
  if (status === "failed") return tPage("refund.status.failed");
  if (status === "processing") return tPage("refund.status.processing");
  return tPage("refund.status.pending");
}

function contactLine(
  contact: { name?: string | null; email: string | null; phone: string | null },
  fallback: string,
) {
  const parts = [contact.name, contact.email, contact.phone].filter(
    (value): value is string => Boolean(value && value.trim()),
  );
  return parts.length ? parts.join(" · ") : fallback;
}

// ── 时间线句式 ───────────────────────────────────────────────────────────────

const SUBSCRIPTION_EVENT_KINDS = new Set([
  "created",
  "renewed",
  "upgraded",
  "downgraded",
  "cancelled",
  "suspended",
  "resumed",
  "suspension_updated",
  "activated",
]);

interface TimelineContext {
  readonly order: Order;
  readonly locale: string;
  readonly tPage: TPage;
  readonly productLine: string;
}

function actorLabel(event: OrderOperationEvent, tPage: TPage) {
  if (event.actorName) return event.actorName;
  if (event.actorType === "customer") return tPage("timeline.actor.customer");
  if (event.actorType === "operator") return tPage("timeline.actor.operator");
  return tPage("timeline.actor.system");
}

/**
 * 一条事件 → 一句人话。13 个订单事件各一句（带备注的另有 WithRemark 变体，
 * 条件片段不拼接，每种组合一条完整句）；履约后的订阅变更单独一组；不认识的事件码
 * 回落到「更新了订单」，机器词只进「详情」折叠区。
 */
function timelineSentence(event: OrderOperationEvent, ctx: TimelineContext) {
  const { order, locale, tPage } = ctx;
  const actor = actorLabel(event, tPage);
  const remark = event.remark?.trim() || null;
  const amount = formatOrderAmount(order.amount, order.currency);

  if (event.group === "subscription") {
    const kind = SUBSCRIPTION_EVENT_KINDS.has(event.kind)
      ? event.kind
      : "other";
    return tPage(`timeline.subscription.${kind}`, { actor });
  }

  switch (event.kind) {
    case "created":
      return tPage("timeline.order.created", {
        actor,
        product: ctx.productLine,
        amount,
      });
    case "payment_declared":
      return remark
        ? tPage("timeline.order.payment_declaredWithRemark", { actor, remark })
        : tPage("timeline.order.payment_declared", { actor });
    case "payment_rejected":
      return remark
        ? tPage("timeline.order.payment_rejectedWithRemark", { actor, remark })
        : tPage("timeline.order.payment_rejected", { actor });
    case "payment_confirmed":
      return remark
        ? tPage("timeline.order.payment_confirmedWithRemark", {
            actor,
            amount,
            remark,
          })
        : tPage("timeline.order.payment_confirmed", { actor, amount });
    case "fulfilled": {
      const endAt = order.fulfilledSubscription?.endAt ?? null;
      return endAt
        ? tPage("timeline.order.fulfilledWithEnd", {
            code: order.orderNo,
            date: formatDay(endAt, locale, "—"),
          })
        : tPage("timeline.order.fulfilled", { code: order.orderNo });
    }
    case "cancelled":
      if (event.actorType === "customer") {
        return remark
          ? tPage("timeline.order.cancelledByCustomerWithRemark", {
              actor,
              remark,
            })
          : tPage("timeline.order.cancelledByCustomer", { actor });
      }
      return remark
        ? tPage("timeline.order.cancelledByOperatorWithRemark", {
            actor,
            remark,
          })
        : tPage("timeline.order.cancelledByOperator", { actor });
    case "order_expired":
      return tPage("timeline.order.order_expired");
    case "restored":
      return remark
        ? tPage("timeline.order.restoredWithRemark", { actor, remark })
        : tPage("timeline.order.restored", { actor });
    case "refund_requested": {
      const refundAmount = formatOrderAmount(
        order.refund?.amount ?? order.amount,
        order.currency,
      );
      return remark
        ? tPage("timeline.order.refund_requestedWithRemark", {
            actor,
            amount: refundAmount,
            remark,
          })
        : tPage("timeline.order.refund_requested", {
            actor,
            amount: refundAmount,
          });
    }
    case "refund_approved":
      return remark
        ? tPage("timeline.order.refund_approvedWithRemark", { actor, remark })
        : tPage("timeline.order.refund_approved", { actor });
    case "refund_rejected":
      return remark
        ? tPage("timeline.order.refund_rejectedWithRemark", { actor, remark })
        : tPage("timeline.order.refund_rejected", { actor });
    case "refunded": {
      const refundAmount = formatOrderAmount(
        order.refund?.amount ?? order.amount,
        order.currency,
      );
      return remark
        ? tPage("timeline.order.refundedWithRemark", {
            amount: refundAmount,
            remark,
          })
        : tPage("timeline.order.refunded", { amount: refundAmount });
    }
    case "refund_failed":
      return remark
        ? tPage("timeline.order.refund_failedWithRemark", { remark })
        : tPage("timeline.order.refund_failed");
    default:
      return tPage("timeline.order.other", { actor });
  }
}

function timelineIcon(tone: OrderOperationEvent["tone"]) {
  if (tone === "danger" || tone === "warning") return "warning" as const;
  if (tone === "success") return "check" as const;
  return "info" as const;
}

function TimelineEntry({
  event,
  ctx,
}: {
  event: OrderOperationEvent;
  ctx: TimelineContext;
}) {
  const { locale, tPage } = ctx;
  const [open, setOpen] = useState(false);
  // 技术细节只在「详情」里：状态迁移、原始备注、事件码。默认不展开。
  const details: string[] = [];
  if (event.fromStatus || event.toStatus) {
    details.push(
      tPage("timeline.detail.transition", {
        from: event.fromStatus ?? "—",
        to: event.toStatus ?? "—",
      }),
    );
  }
  if (event.remark?.trim()) {
    details.push(tPage("timeline.detail.remark", { remark: event.remark }));
  }
  details.push(tPage("timeline.detail.kind", { kind: event.kind }));

  return (
    <PanelItem
      lead={
        <span
          aria-hidden="true"
          className={`inline-grid size-icon-md place-items-center rounded-full border ${toneSurfaceClasses[event.tone as StatusBadgeTone] ?? toneSurfaceClasses.neutral}`}
        >
          <Icon
            name={timelineIcon(event.tone)}
            size="xs"
            fallback="placeholder"
          />
        </span>
      }
      main={
        <span className="grid min-w-0 gap-2xs">
          <TableTitleCell
            title={<>{timelineSentence(event, ctx)}</>}
            description={<>{dayAndClock(event.at, locale)}</>}
          />
          {open ? (
            <ul className="m-0 grid list-none gap-2xs p-0 text-body-sm text-muted-foreground">
              {details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </span>
      }
      trail={
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? tPage("timeline.hideDetails") : tPage("timeline.details")}
        </Button>
      }
    />
  );
}

// ── 页头 ─────────────────────────────────────────────────────────────────────

function OrderHeader({
  order,
  productLine,
  busy,
  onConfirm,
  onReject,
  menuItems,
}: {
  order: Order;
  productLine: string;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
  menuItems: readonly ActionMenuItem[];
}) {
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const paySourceLabel = usePaySourceLabel();
  const { toast } = useToast();

  async function copyOrderNo() {
    try {
      await navigator.clipboard?.writeText(order.orderNo);
      toast({ tone: "success", title: tPage("header.copied") });
    } catch {
      /* 剪贴板不可用（http 页面、权限被拒）：订单号就在眼前，手抄即可，不报错打扰。 */
    }
  }

  const tenantCode = formatPrincipalNoOr(order.tenantCode, "tenant", "—");
  const showPrimary = order.orderStatus === "pending_verify";

  /* 用 DS `ViewHeader` 而不是 admin 的 `PageHeader` 壳：壳把 title 收成 string，
     而这里的标题是「等宽订单号 + 复制钮」两个节点。壳本身就是 ViewHeader 的形状适配层。 */
  return (
    <ViewHeader
      icon="receipt"
      title={
        <span className="inline-flex min-w-0 items-center gap-xs">
          <span className="font-mono">{order.orderNo}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            aria-label={tPage("header.copyOrderNo")}
            title={tPage("header.copyOrderNo")}
            onClick={() => void copyOrderNo()}
          >
            <Icon name="copy" size="xs" fallback="placeholder" />
          </Button>
        </span>
      }
      secondary={
        /* 一枚徽标 + 一句话（§3.1）：支付态不再单独当徽标，它由这句话与任务卡说。 */
        <span className="inline-flex min-w-0 flex-wrap items-center gap-xs">
          <StatusBadge tone={ORDER_STATUS_TONE_MAP[order.orderStatus]}>
            {tPage(ORDER_STATUS_LABEL_KEY[order.orderStatus])}
          </StatusBadge>
          <span className="text-body-sm font-normal text-muted-foreground">
            {tPage(ORDER_STATUS_HINT_KEY[order.orderStatus])}
          </span>
        </span>
      }
      description={
        <span className="grid min-w-0 gap-2xs">
          <span className="flex min-w-0 flex-wrap items-center gap-xs">
            <Link
              href={`/tenants/${encodeURIComponent(order.tenantCode)}`}
              className="font-semibold text-primary-text no-underline"
            >
              {order.tenantName}
            </Link>
            <span className="font-mono">{tenantCode}</span>
            <span>{typeLabel(order.tenantType)}</span>
            {productLine ? (
              <span className="font-semibold text-foreground">
                {productLine}
              </span>
            ) : null}
          </span>
          <span>
            {tPage("header.placed", {
              day: formatDay(order.createdAt, locale, "—"),
              clock: formatClock(order.createdAt, locale, ""),
              source: paySourceLabel(order.paySource),
            })}
          </span>
        </span>
      }
      action={
        <div className="flex min-w-0 flex-col items-end gap-sm">
          <FactList
            facts={[
              {
                label: tPage("header.due"),
                value: formatOrderAmount(order.amount, order.currency),
              },
              {
                label: tPage("header.received"),
                value: formatOrderAmount(order.paidAmount, order.currency),
                // 收齐了才染绿；没收齐是事实不是状态，跟随正文。
                ...(order.paidAmount >= order.amount
                  ? { tone: "success" as const }
                  : {}),
              },
            ]}
          />
          <div className="flex flex-wrap items-center justify-end gap-xs">
            {showPrimary ? (
              <>
                <Button
                  onClick={onConfirm}
                  disabled={busy || !canConfirmOrderOfflinePayment(order)}
                  title={confirmDisabledReason(order, tPage) ?? undefined}
                >
                  <Icon name="check" size="xs" fallback="placeholder" />
                  {tPage("actions.confirmPayment")}
                </Button>
                <Button variant="outline" onClick={onReject} disabled={busy}>
                  <Icon name="x" size="xs" fallback="placeholder" />
                  {tPage("actions.rejectDeclaration")}
                </Button>
              </>
            ) : null}
            <ActionMenu
              label={tPage("actions.more")}
              items={menuItems}
              disabled={busy}
            />
          </div>
        </div>
      }
    />
  );
}

// ── 任务卡 ───────────────────────────────────────────────────────────────────

function OrderTaskCard({
  order,
  busy,
  onConfirm,
  onReject,
  onRedrive,
  onRestore,
  onRefund,
}: {
  order: Order;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onRedrive: () => void;
  onRestore: () => void;
  onRefund: (mode: RefundDialogMode) => void;
}) {
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const now = useNow();
  const amount = formatOrderAmount(order.amount, order.currency);
  const declared = order.declaredPayment;
  const refund = refundInFlight(order);
  const status = order.orderStatus;

  // 一句任务 + 语气：退款在途优先于订单态（退款是当前的活）。
  let tone: StatusBadgeTone = "info";
  let title: string;
  let body: string;
  if (refund) {
    const refundAmount = formatOrderAmount(refund.amount, order.currency);
    tone = refund.auditStatus === "pending" ? "warning" : "info";
    title = tPage("task.title.refunding");
    body =
      refund.auditStatus === "pending"
        ? tPage("task.body.refundPending", { amount: refundAmount })
        : refund.refundStatus === "failed"
          ? tPage("task.body.refundFailed", { amount: refundAmount })
          : tPage("task.body.refundApproved", { amount: refundAmount });
  } else {
    switch (status) {
      case "pending":
        tone = "info";
        title = tPage("task.title.pending");
        body = tPage("task.body.pending");
        break;
      case "pending_verify":
        tone = "warning";
        title = tPage("task.title.pending_verify", { amount });
        body = tPage("task.body.pending_verify");
        break;
      case "paid_unprovisioned":
        tone = "info";
        title = tPage("task.title.paid_unprovisioned");
        body = tPage("task.body.paid_unprovisioned");
        break;
      case "partial_pending":
        tone = "warning";
        title = tPage("task.title.partial_pending");
        body = tPage("task.body.partial_pending", {
          received: formatOrderAmount(order.paidAmount, order.currency),
          remaining: formatOrderAmount(
            Math.max(0, order.amount - order.paidAmount),
            order.currency,
          ),
        });
        break;
      case "confirmed":
        tone = "success";
        title = tPage("task.title.confirmed");
        body = tPage("task.body.confirmed");
        break;
      case "closed":
        tone = "neutral";
        title = tPage("task.title.closed");
        body = tPage("task.body.closed", {
          reason: closeReasonLabel(order.closeReason, tPage),
        });
        break;
      case "refunded":
        tone = "neutral";
        title = tPage("task.title.refunded");
        body = tPage("task.body.refunded");
        break;
      default:
        tone = "danger";
        title = tPage("task.title.abnormal");
        body = tPage("task.body.abnormal");
    }
  }

  // 任务卡还要带的三样（§3.2）：申报摘要、到哪里找这笔钱、倒计时走不走。
  const lines: Array<{ key: string; text: string; tone?: StatusBadgeTone }> =
    [];
  if (
    declared &&
    (status === "pending_verify" || status === "partial_pending")
  ) {
    lines.push({
      key: "declared",
      text: tPage("task.declared", {
        day: formatDay(declared.declaredAt, locale, "—"),
        clock: formatClock(declared.declaredAt, locale, ""),
        channel: channelLabel(declared.channel, tPage),
        payer: declared.payerName || tPage("declaration.notFilled"),
        txn: declared.transactionNo || tPage("declaration.notFilled"),
      }),
    });
    lines.push({
      key: "guidance",
      text:
        declared.channel === "alipay"
          ? tPage("task.guidance.alipay")
          : declared.channel === "bank"
            ? tPage("task.guidance.bank")
            : tPage("task.guidance.generic"),
    });
  }
  const deadline = order.paymentDeadline;
  if (deadline) {
    if (deadline.frozen) {
      lines.push({ key: "deadline", text: tPage("task.deadline.frozen") });
    } else if (deadline.expireAt) {
      const expireMs = new Date(deadline.expireAt).getTime();
      const remainingMs = now === null ? null : expireMs - now;
      if (remainingMs !== null && remainingMs <= 0) {
        lines.push({
          key: "deadline",
          text: tPage("task.deadline.overdue"),
          tone: "danger",
        });
      } else {
        lines.push({
          key: "deadline",
          text: tPage("task.deadline.until", {
            day: formatDay(deadline.expireAt, locale, "—"),
            clock: formatClock(deadline.expireAt, locale, ""),
            remaining:
              remainingMs === null ? "—" : formatDuration(remainingMs, tPage),
          }),
        });
      }
    }
  }
  if (status === "confirmed" && order.fulfilledSubscription) {
    const sub = order.fulfilledSubscription;
    lines.push({
      key: "fulfilled",
      text: sub.endAt
        ? tPage("task.fulfilled", {
            code: order.orderNo,
            date: formatDay(sub.endAt, locale, "—"),
            autoRenew: sub.autoRenew
              ? tPage("autoRenew.on")
              : tPage("autoRenew.off"),
          })
        : tPage("task.fulfilledNoEnd", { code: order.orderNo }),
    });
  }
  if (refund) {
    lines.push({
      key: "refund-reason",
      text: tPage("task.refundReason", {
        reason: refund.reason?.trim() || tPage("declaration.notFilled"),
      }),
    });
  }

  // 主按钮：只放当前这一步能做的事，其余在页头「更多」。
  let actions: React.ReactNode = null;
  if (refund) {
    actions =
      refund.auditStatus === "pending" ? (
        <>
          <Button onClick={() => onRefund("approve")} disabled={busy}>
            <Icon name="check" size="xs" fallback="placeholder" />
            {tPage("actions.approveRefund")}
          </Button>
          <Button
            variant="outline"
            onClick={() => onRefund("reject")}
            disabled={busy}
          >
            <Icon name="x" size="xs" fallback="placeholder" />
            {tPage("actions.rejectRefund")}
          </Button>
        </>
      ) : (
        <>
          <Button onClick={() => onRefund("execute")} disabled={busy}>
            <Icon name="check" size="xs" fallback="placeholder" />
            {tPage("actions.completeRefund")}
          </Button>
          <Button
            variant="outline"
            onClick={() => onRefund("fail")}
            disabled={busy}
          >
            <Icon name="warning" size="xs" fallback="placeholder" />
            {tPage("actions.failRefund")}
          </Button>
        </>
      );
  } else if (status === "pending_verify") {
    actions = (
      <>
        <Button
          onClick={onConfirm}
          disabled={busy || !canConfirmOrderOfflinePayment(order)}
          title={confirmDisabledReason(order, tPage) ?? undefined}
        >
          <Icon name="check" size="xs" fallback="placeholder" />
          {tPage("actions.confirmPayment")}
        </Button>
        <Button variant="outline" onClick={onReject} disabled={busy}>
          <Icon name="x" size="xs" fallback="placeholder" />
          {tPage("actions.rejectDeclaration")}
        </Button>
      </>
    );
  } else if (status === "paid_unprovisioned") {
    actions = (
      <Button variant="outline" onClick={onRedrive} disabled={busy}>
        <Icon name="play" size="xs" fallback="placeholder" />
        {tPage("actions.retryProvision")}
      </Button>
    );
  } else if (status === "closed" && order.restorable) {
    actions = (
      <Button variant="outline" onClick={onRestore} disabled={busy}>
        <Icon name="undo" size="xs" fallback="placeholder" />
        {tPage("actions.restoreOrder")}
      </Button>
    );
  } else if (status === "confirmed" && order.fulfilledSubscription) {
    actions = (
      <Button asChild variant="outline">
        <Link href={`/subscriptions/${encodeURIComponent(order.orderNo)}`}>
          <Icon name="star" size="xs" fallback="placeholder" />
          {tPage("links.subscription")}
        </Link>
      </Button>
    );
  }

  return (
    <Section
      tone="glass"
      level={2}
      icon="list-checks"
      title={tPage("task.sectionTitle")}
      className="min-w-0"
    >
      <div className="grid min-w-0 gap-md">
        <OrderStageStrip stages={orderStagePlan(order)} />
        <Banner
          tone={tone}
          title={title}
          description={
            <span className="grid min-w-0 gap-xs">
              <span>{body}</span>
              {lines.map((line) => (
                <span
                  key={line.key}
                  className={
                    line.tone === "danger"
                      ? "font-semibold text-destructive-text"
                      : undefined
                  }
                >
                  {line.text}
                </span>
              ))}
            </span>
          }
          action={
            actions ? (
              <span className="flex flex-wrap items-center gap-xs">
                {actions}
              </span>
            ) : undefined
          }
        />
      </div>
    </Section>
  );
}

// ── 左栏 ─────────────────────────────────────────────────────────────────────

function DeclarationSection({ order }: { order: Order }) {
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const now = useNow();
  const declared = order.declaredPayment;
  const declaredBy = order.declaredBy;
  if (!declared && !declaredBy) return null;

  const notFilled = tPage("declaration.notFilled");
  const waitedMs =
    declared && now !== null
      ? now - new Date(declared.declaredAt).getTime()
      : null;
  // 超过 24 小时没人核对，等待时长标橙——这是客服最该先处理的单。
  const waitedTone: StatusBadgeTone =
    waitedMs !== null && waitedMs > 24 * 60 * 60_000 ? "warning" : "neutral";

  return (
    <Section
      tone="glass"
      level={2}
      icon="receipt"
      title={tPage("sections.declaration")}
      className="min-w-0"
    >
      <DetailList columns={1}>
        {declared ? (
          <>
            <DetailRow label={tPage("declaration.declaredAt")}>
              <span className="inline-flex flex-wrap items-center gap-xs">
                <span>{dayAndClock(declared.declaredAt, locale)}</span>
                {waitedMs !== null ? (
                  <StatusBadge tone={waitedTone} icon={false}>
                    {tPage("declaration.waited", {
                      duration: formatDuration(waitedMs, tPage),
                    })}
                  </StatusBadge>
                ) : null}
              </span>
            </DetailRow>
            <DetailRow label={tPage("declaration.amount")}>
              <span className="font-semibold">
                {formatOrderAmount(declared.amount, order.currency)}
              </span>
            </DetailRow>
            <DetailRow label={tPage("declaration.channel")}>
              {channelLabel(declared.channel, tPage)}
            </DetailRow>
            <DetailRow label={tPage("declaration.payer")}>
              {declared.payerName || notFilled}
            </DetailRow>
            <DetailRow label={tPage("declaration.txnNo")}>
              {declared.transactionNo ? (
                <span className="font-mono">{declared.transactionNo}</span>
              ) : (
                notFilled
              )}
            </DetailRow>
            <DetailRow label={tPage("declaration.remark")}>
              {declared.remark?.trim() || notFilled}
            </DetailRow>
          </>
        ) : null}
        {declaredBy ? (
          <DetailRow label={tPage("declaration.declaredBy")}>
            {contactLine(
              {
                name: declaredBy.displayName,
                email: declaredBy.email,
                phone: declaredBy.phone,
              },
              tPage("empty"),
            )}
          </DetailRow>
        ) : null}
      </DetailList>
    </Section>
  );
}

function AmountsSection({ order }: { order: Order }) {
  const tPage = useTranslations("orderDetailPage");
  const money = (value: number) => formatOrderAmount(value, order.currency);
  const remaining = Math.max(0, order.amount - order.paidAmount);
  const showRemaining =
    remaining > 0 &&
    order.orderStatus !== "closed" &&
    order.orderStatus !== "refunded";
  // 标价没下发（0）时不单列一行——应付那一行已经是全部信息。
  const showListPrice =
    order.listAmount > 0 &&
    (order.creditAmount > 0 || order.listAmount !== order.amount);

  return (
    <Section
      tone="glass"
      level={2}
      icon="coins"
      title={tPage("sections.amounts")}
      className="min-w-0"
    >
      <DetailList columns={1}>
        {order.invoiceItems.map((item) => (
          <DetailRow
            key={item.id}
            label={invoiceItemTypeLabel(item.itemType, tPage)}
          >
            <span className="grid min-w-0 gap-2xs">
              <span>{money(item.totalAmount)}</span>
              <span className="text-body-sm text-muted-foreground">
                {item.itemName}
              </span>
            </span>
          </DetailRow>
        ))}
        {showListPrice ? (
          <DetailRow label={tPage("fields.listPrice")}>
            {money(order.listAmount)}
          </DetailRow>
        ) : null}
        {order.creditAmount > 0 ? (
          <DetailRow label={tPage("fields.credit")}>
            <span className="grid min-w-0 gap-2xs">
              <span>{`− ${money(order.creditAmount)}`}</span>
              <span className="text-body-sm text-muted-foreground">
                {tPage("fields.creditHint")}
              </span>
            </span>
          </DetailRow>
        ) : null}
        {order.leftoverAmount > 0 ? (
          <DetailRow label={tPage("fields.leftover")}>
            <span className="grid min-w-0 gap-2xs">
              <span>{money(order.leftoverAmount)}</span>
              <span className="text-body-sm text-muted-foreground">
                {tPage("fields.leftoverHint")}
              </span>
            </span>
          </DetailRow>
        ) : null}
        <DetailRow label={tPage("fields.due")}>
          <span className="font-semibold text-foreground">
            {money(order.amount)}
          </span>
        </DetailRow>
        <DetailRow label={tPage("fields.received")}>
          {money(order.paidAmount)}
        </DetailRow>
        {showRemaining ? (
          <DetailRow label={tPage("fields.remaining")}>
            {money(remaining)}
          </DetailRow>
        ) : null}
      </DetailList>
    </Section>
  );
}

function TimelineSection({
  order,
  productLine,
}: {
  order: Order;
  productLine: string;
}) {
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const ctx: TimelineContext = { order, locale, tPage, productLine };
  const orderEvents = order.operationTimeline.filter(
    (event) => event.group !== "subscription",
  );
  const subscriptionEvents = order.operationTimeline.filter(
    (event) => event.group === "subscription",
  );

  return (
    <Section
      tone="glass"
      level={2}
      icon="clock"
      title={tPage("sections.timeline")}
      className="min-w-0"
    >
      <div className="grid min-w-0 gap-md">
        <PanelList empty={tPage("timeline.empty")}>
          {orderEvents.map((event) => (
            <TimelineEntry key={event.id} event={event} ctx={ctx} />
          ))}
        </PanelList>
        {subscriptionEvents.length ? (
          <>
            <SectionHeader
              level={3}
              icon="star"
              title={tPage("sections.subscriptionEvents")}
            />
            <PanelList>
              {subscriptionEvents.map((event) => (
                <TimelineEntry key={event.id} event={event} ctx={ctx} />
              ))}
            </PanelList>
          </>
        ) : null}
      </div>
    </Section>
  );
}

// ── 右栏 ─────────────────────────────────────────────────────────────────────

function OrderInfoSection({ order }: { order: Order }) {
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const paySourceLabel = usePaySourceLabel();
  const now = useNow();
  const deadline = order.paymentDeadline;
  let deadlineText: string | null = null;
  if (deadline?.frozen) deadlineText = tPage("fields.deadlineFrozen");
  else if (deadline?.expireAt) {
    const remainingMs =
      now === null ? null : new Date(deadline.expireAt).getTime() - now;
    deadlineText =
      remainingMs !== null && remainingMs <= 0
        ? tPage("task.deadline.overdue")
        : tPage("fields.deadlineUntil", {
            day: formatDay(deadline.expireAt, locale, "—"),
            clock: formatClock(deadline.expireAt, locale, ""),
          });
  }

  return (
    <Section
      tone="glass"
      level={2}
      icon="file-text"
      title={tPage("sections.order")}
      className="min-w-0"
    >
      <DetailList columns={1}>
        <DetailRow label={tPage("fields.orderNo")}>
          <span className="font-mono">{order.orderNo}</span>
        </DetailRow>
        <DetailRow label={tPage("fields.billNo")}>
          {order.billNo ? (
            <span className="font-mono">{order.billNo}</span>
          ) : (
            tPage("empty")
          )}
        </DetailRow>
        <DetailRow label={tPage("fields.payNo")}>
          {order.paymentNo ? (
            <span className="font-mono">{order.paymentNo}</span>
          ) : (
            tPage("empty")
          )}
        </DetailRow>
        <DetailRow label={tPage("fields.intent")}>
          {intentLabel(order.intent, tPage)}
        </DetailRow>
        <DetailRow label={tPage("fields.placedAt")}>
          {dayAndClock(order.createdAt, locale)}
        </DetailRow>
        <DetailRow label={tPage("fields.source")}>
          {paySourceLabel(order.paySource)}
        </DetailRow>
        <DetailRow label={tPage("fields.autoRenew")}>
          {order.autoRenew ? tPage("autoRenew.on") : tPage("autoRenew.off")}
        </DetailRow>
        {deadlineText ? (
          <DetailRow label={tPage("fields.deadline")}>{deadlineText}</DetailRow>
        ) : null}
        {order.orderStatus === "closed" ? (
          <DetailRow label={tPage("fields.closeReason")}>
            {closeReasonLabel(order.closeReason, tPage)}
          </DetailRow>
        ) : null}
      </DetailList>
    </Section>
  );
}

function TenantSection({ order }: { order: Order }) {
  const tPage = useTranslations("orderDetailPage");
  const tShared = useTranslations();
  const contact = order.billingContact;

  return (
    <Section
      tone="glass"
      level={2}
      icon="buildings"
      title={tPage("sections.tenant")}
      className="min-w-0"
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={`/tenants/${encodeURIComponent(order.tenantCode)}`}>
            <Icon name="buildings" size="xs" fallback="placeholder" />
            {tShared("actions.viewTenant")}
          </Link>
        </Button>
      }
    >
      <DetailList columns={1}>
        <DetailRow label={tPage("fields.tenant")}>
          <Link
            href={`/tenants/${encodeURIComponent(order.tenantCode)}`}
            className="font-semibold text-primary-text no-underline"
          >
            {order.tenantName}
          </Link>
        </DetailRow>
        <DetailRow label={tShared("columns.tenantCode")}>
          <span className="font-mono">
            {formatPrincipalNoOr(order.tenantCode, "tenant", "—")}
          </span>
        </DetailRow>
        <DetailRow label={tShared("columns.tenantType")}>
          {typeLabel(order.tenantType)}
        </DetailRow>
        {!isUnset(order.industry) ? (
          <DetailRow label={tPage("fields.industry")}>
            {order.industry}
          </DetailRow>
        ) : null}
        {!isUnset(order.region) ? (
          <DetailRow label={tPage("fields.region")}>{order.region}</DetailRow>
        ) : null}
        <DetailRow
          label={
            contact?.contactType === "primary"
              ? tPage("fields.primaryContact")
              : tPage("fields.billingContact")
          }
        >
          {contact ? contactLine(contact, tPage("empty")) : tPage("empty")}
        </DetailRow>
      </DetailList>
    </Section>
  );
}

function FulfillmentSection({ order }: { order: Order }) {
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const subscriptionStatusLabels = useSubscriptionStatusLabels();
  const sub = order.fulfilledSubscription;
  // 订阅状态值域与 admin 的运营视角不完全同集，认识的才显示，不认识的不硬翻。
  const statusLabel = sub
    ? ((subscriptionStatusLabels as Record<string, string>)[sub.status] ?? null)
    : null;

  return (
    <Section
      tone="glass"
      level={2}
      icon="star"
      title={tPage("sections.fulfillment")}
      className="min-w-0"
      action={
        sub ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/subscriptions/${encodeURIComponent(order.orderNo)}`}>
              <Icon name="star" size="xs" fallback="placeholder" />
              {tPage("links.subscription")}
            </Link>
          </Button>
        ) : undefined
      }
    >
      {sub ? (
        <DetailList columns={1}>
          <DetailRow label={tPage("fields.subscriptionCode")}>
            <span className="font-mono">{order.orderNo}</span>
          </DetailRow>
          {statusLabel ? (
            <DetailRow label={tPage("fields.subscriptionStatus")}>
              {statusLabel}
            </DetailRow>
          ) : null}
          <DetailRow label={tPage("fields.validity")}>
            {sub.endAt
              ? tPage("fulfillment.validity", {
                  start: formatDay(sub.startAt, locale, "—"),
                  end: formatDay(sub.endAt, locale, "—"),
                })
              : tPage("fulfillment.noEnd", {
                  start: formatDay(sub.startAt, locale, "—"),
                })}
          </DetailRow>
          <DetailRow label={tPage("fields.autoRenew")}>
            {sub.autoRenew ? tPage("autoRenew.on") : tPage("autoRenew.off")}
          </DetailRow>
        </DetailList>
      ) : (
        <p className="m-0 text-body-sm text-muted-foreground">
          {order.orderStatus === "closed"
            ? tPage("fulfillment.closed")
            : order.orderStatus === "refunded"
              ? tPage("fulfillment.refunded")
              : tPage("fulfillment.pending")}
        </p>
      )}
    </Section>
  );
}

function RefundSection({ order }: { order: Order }) {
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const refund = order.refund ?? null;
  if (!refund) return null;

  return (
    <Section
      tone="glass"
      level={2}
      icon="undo"
      title={tPage("sections.refund")}
      className="min-w-0"
    >
      <DetailList columns={1}>
        <DetailRow label={tPage("fields.refundNo")}>
          <span className="font-mono">{refund.refundNo}</span>
        </DetailRow>
        <DetailRow label={tPage("fields.refundAmount")}>
          {formatOrderAmount(refund.amount, order.currency)}
        </DetailRow>
        <DetailRow label={tPage("fields.refundReason")}>
          {refund.reason?.trim() || tPage("declaration.notFilled")}
        </DetailRow>
        <DetailRow label={tPage("fields.refundRequestedAt")}>
          {dayAndClock(refund.requestedAt, locale)}
        </DetailRow>
        <DetailRow label={tPage("fields.refundAudit")}>
          <span className="inline-flex flex-wrap items-center gap-xs">
            <StatusBadge
              tone={
                refund.auditStatus === "approved"
                  ? "success"
                  : refund.auditStatus === "rejected"
                    ? "danger"
                    : "warning"
              }
            >
              {refundAuditLabel(refund.auditStatus, tPage)}
            </StatusBadge>
            {refund.auditedAt ? (
              <span className="text-body-sm text-muted-foreground">
                {dayAndClock(refund.auditedAt, locale)}
              </span>
            ) : null}
          </span>
        </DetailRow>
        {refund.auditRemark?.trim() ? (
          <DetailRow label={tPage("fields.refundAuditRemark")}>
            {refund.auditRemark}
          </DetailRow>
        ) : null}
        <DetailRow label={tPage("fields.refundPayout")}>
          <span className="inline-flex flex-wrap items-center gap-xs">
            <StatusBadge
              tone={
                refund.refundStatus === "success"
                  ? "success"
                  : refund.refundStatus === "failed"
                    ? "danger"
                    : refund.refundStatus === "processing"
                      ? "info"
                      : "neutral"
              }
            >
              {refundStatusLabel(refund.refundStatus, tPage)}
            </StatusBadge>
            {refund.refundedAt ? (
              <span className="text-body-sm text-muted-foreground">
                {dayAndClock(refund.refundedAt, locale)}
              </span>
            ) : null}
          </span>
        </DetailRow>
      </DetailList>
    </Section>
  );
}

// ── 页面 ─────────────────────────────────────────────────────────────────────

export function OrderDetailPage({ orderId }: { orderId: string }) {
  const tPage = useTranslations("orderDetailPage");
  const tShared = useTranslations();
  const router = useRouter();
  const cycleLabels = useSubscriptionCycleLabels();
  const { runWithStepUp } = useStepUp();
  const { toast } = useToast();
  const [order, setOrder] = useState<Order | null>(null);
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
  /*
   * 退款（product_330 §5）：approve / reject = 审核；execute = 已打款后执行（订单
   * refunded + 订阅回滚）；fail = 钱**没**打出去（账号不对、银行退回，2026-09-25 补）。
   * execute 与 fail 是同一步的两个结果，所以同一个对话框、同一套权限。
   */
  const [refundDialog, setRefundDialog] = useState<RefundDialogMode | null>(
    null,
  );
  const [refundRemark, setRefundRemark] = useState("");
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

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

  const busy =
    submittingPayment ||
    submittingReject ||
    submittingVoid ||
    submittingRestore ||
    submittingRefund;
  const anyDialogOpen =
    paymentDialogOpen ||
    rejectDialogOpen ||
    voidDialogOpen ||
    restoreDialogOpen ||
    refundDialog !== null;

  function openDialog(open: () => void) {
    setOperationError(null);
    open();
  }

  function succeed(message: string) {
    toast({ tone: "success", title: message });
  }

  async function handleConfirmOfflinePayment(
    payload: Parameters<typeof confirmOrderOfflinePayment>[1],
  ) {
    if (!order) return;
    setSubmittingPayment(true);
    setOperationError(null);
    try {
      // 确认线下收款是 危 commerce:payment.settle → step-up。
      const updated = await runWithStepUp(() =>
        confirmOrderOfflinePayment(order.id, payload),
      );
      setOrder(updated);
      setPaymentDialogOpen(false);
      succeed(tPage("feedback.paymentConfirmed"));
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
      // 驳回与确认同一个危码（commerce:payment.settle）→ step-up。
      const updated = await runWithStepUp(() =>
        rejectOrderPaymentDeclaration(order.id, rejectReason),
      );
      setOrder(updated);
      setRejectDialogOpen(false);
      setRejectReason("");
      succeed(tPage("feedback.declarationRejected"));
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
      // 与确认收款同一个端点：后端识别「已付未开通」的挂单，重驱动段 2，不要求申报字段（P8 ③）。
      const updated = await runWithStepUp(() =>
        confirmOrderOfflinePayment(order.id, {
          paidAmount: 0,
          offlinePayType: "other",
          payerName: "-",
          paidAt: new Date().toISOString(),
          reason: "manual stage-2 re-drive",
        }),
      );
      setOrder(updated);
      succeed(tPage("feedback.provisionRetried"));
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
      // 作废是 危 commerce:order.void → step-up。
      const updated = await runWithStepUp(
        () => voidOrder(order.id, voidReason),
        { danger: true },
      );
      setOrder(updated);
      setVoidDialogOpen(false);
      setVoidReason("");
      succeed(tPage("feedback.orderVoided"));
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      setOperationError(
        error instanceof Error ? error.message : tPage("feedback.voidFailed"),
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
      // 退款四个端点都 @RequireStepUp；此前这里直接调用不走 runWithStepUp，
      // 没有有效 step-up cookie 时对话框里直接出现 step_up_required（设计稿 §6.2 第 1 条）。
      const updated = await runWithStepUp(() =>
        refundDialog === "execute"
          ? executeOrderRefund(order.id, refundRemark)
          : refundDialog === "fail"
            ? failOrderRefund(order.id, refundRemark)
            : refundDialog === "create"
              ? createOrderRefund(order.id, refundRemark)
              : auditOrderRefund(
                  order.id,
                  refundDialog === "approve" ? "approved" : "rejected",
                  refundRemark,
                ),
      );
      setOrder(updated);
      succeed(
        refundDialog === "execute"
          ? tPage("feedback.refundExecuted")
          : refundDialog === "fail"
            ? tPage("feedback.refundMarkedFailed")
            : refundDialog === "create"
              ? tPage("feedback.refundCreated")
              : refundDialog === "approve"
                ? tPage("feedback.refundApproved")
                : tPage("feedback.refundRejected"),
      );
      setRefundDialog(null);
      setRefundRemark("");
    } catch (error) {
      if (isStepUpCancelled(error)) return;
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
      // 恢复是 危 commerce:order.restore → step-up。
      const updated = await runWithStepUp(() =>
        restoreOrder(order.id, restoreReason),
      );
      setOrder(updated);
      setRestoreDialogOpen(false);
      setRestoreReason("");
      succeed(tPage("feedback.orderRestored"));
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

  const backLink = (
    <Link
      className="inline-flex min-h-icon-xl w-fit items-center gap-xs text-body-sm font-extrabold text-primary-text no-underline"
      href="/orders"
    >
      <Icon name="arrow-left" size="xs" fallback="placeholder" />
      {tShared("actions.backToList")}
    </Link>
  );

  if (!loading && !order) {
    return (
      <DetailPageTemplate
        className="min-w-0"
        header={
          <>
            {backLink}
            <ViewHeader
              icon="receipt"
              title={tPage("title")}
              description={tPage("notFound.description")}
            />
          </>
        }
      >
        <EmptyState
          title={tPage("noAccess.title")}
          description={tPage("noAccess.description")}
        />
      </DetailPageTemplate>
    );
  }

  if (!order) {
    return (
      <DetailPageTemplate
        className="min-w-0"
        header={
          <>
            {backLink}
            <ViewHeader
              icon="receipt"
              title={tPage("title")}
              description={tPage("loading")}
            />
          </>
        }
      >
        <p className="m-0 text-body-sm text-muted-foreground">
          {tShared("common.loading")}
        </p>
      </DetailPageTemplate>
    );
  }

  // 「买的是什么」一行：方案 · 套餐 · 档位 · 周期，没值的段落不占位。
  const productLine = [
    order.solutionName,
    order.servicePlanName,
    order.tierName,
    cycleLabels[order.cycleType],
  ]
    .filter((value) => !isUnset(value))
    .join(" · ");

  const refund = order.refund ?? null;
  const openRefundDialog = (mode: RefundDialogMode) =>
    openDialog(() => {
      setRefundRemark("");
      setRefundDialog(mode);
    });

  // 「更多」：按当前状态只列能做的事；灰着的项要说为什么灰。
  const menuItems: ActionMenuItem[] = [
    {
      id: "tenant",
      label: tShared("actions.viewTenant"),
      icon: "buildings",
      onSelect: () =>
        router.push(`/tenants/${encodeURIComponent(order.tenantCode)}`),
    },
  ];
  if (order.fulfilledSubscription) {
    menuItems.push({
      id: "subscription",
      label: tPage("links.subscription"),
      icon: "star",
      onSelect: () =>
        router.push(`/subscriptions/${encodeURIComponent(order.orderNo)}`),
    });
  }
  if (order.orderStatus === "paid_unprovisioned") {
    menuItems.push({
      id: "redrive",
      label: tPage("actions.retryProvision"),
      icon: "play",
      separatorBefore: true,
      disabled: busy,
      onSelect: () => void handleRedriveProvisioning(),
    });
  }
  // 逃生口（批 6）：已履约、还没有退款单时，运营可以发起一笔——
  // 此前 24 小时窗口一过就谁也退不了，连误驳回都救不回来。
  if (order.orderStatus === "confirmed" && !refund) {
    menuItems.push({
      id: "refund-create",
      label: tPage("actions.createRefund"),
      icon: "undo",
      separatorBefore: true,
      onSelect: () => openRefundDialog("create"),
    });
  }
  if (refund && refund.auditStatus === "pending") {
    menuItems.push(
      {
        id: "refund-approve",
        label: tPage("actions.approveRefund"),
        icon: "check",
        separatorBefore: true,
        onSelect: () => openRefundDialog("approve"),
      },
      {
        id: "refund-reject",
        label: tPage("actions.rejectRefund"),
        icon: "x",
        onSelect: () => openRefundDialog("reject"),
      },
    );
  }
  if (
    refund &&
    refund.auditStatus === "approved" &&
    refund.refundStatus !== "success"
  ) {
    menuItems.push(
      {
        id: "refund-execute",
        label: tPage("actions.completeRefund"),
        icon: "check",
        separatorBefore: true,
        onSelect: () => openRefundDialog("execute"),
      },
      {
        id: "refund-fail",
        label: tPage("actions.failRefund"),
        icon: "warning",
        onSelect: () => openRefundDialog("fail"),
      },
    );
  }
  if (order.orderStatus === "closed") {
    menuItems.push({
      id: "restore",
      label: tPage("actions.restoreOrder"),
      icon: "undo",
      separatorBefore: true,
      disabled: !order.restorable,
      hint: restoreDisabledReason(order, tPage) ?? undefined,
      onSelect: () =>
        openDialog(() => {
          setRestoreReason("");
          setRestoreDialogOpen(true);
        }),
    });
  }
  if (
    order.orderStatus === "pending" ||
    order.orderStatus === "pending_verify" ||
    order.orderStatus === "partial_pending"
  ) {
    menuItems.push({
      id: "void",
      label: tPage("actions.voidOrder"),
      icon: "prohibit",
      separatorBefore: true,
      disabled: !canVoidOrder(order),
      hint: voidDisabledReason(order, tPage) ?? undefined,
      onSelect: () =>
        openDialog(() => {
          setVoidReason("");
          setVoidDialogOpen(true);
        }),
    });
  }

  const openConfirm = () => openDialog(() => setPaymentDialogOpen(true));
  const openReject = () =>
    openDialog(() => {
      setRejectReason("");
      setRejectDialogOpen(true);
    });

  return (
    <DetailPageTemplate
      className="min-w-0"
      header={
        <>
          {backLink}
          <OrderHeader
            order={order}
            productLine={productLine}
            busy={busy}
            onConfirm={openConfirm}
            onReject={openReject}
            menuItems={menuItems}
          />
        </>
      }
    >
      {/*
       * 页头动作（「重新开通」）不开对话框，报错必须有页面级落脚处：2026-09-07 生产上
       * 运营点「重试开通」、TOTP 过了、后端报错了，界面上什么都没有。
       */}
      {!anyDialogOpen && operationError ? (
        <Banner
          tone="danger"
          title={tPage("feedback.actionFailed")}
          description={operationError}
          onDismiss={() => setOperationError(null)}
          dismissLabel={tShared("actions.cancel")}
        />
      ) : null}

      <OrderTaskCard
        order={order}
        busy={busy}
        onConfirm={openConfirm}
        onReject={openReject}
        onRedrive={() => void handleRedriveProvisioning()}
        onRestore={() =>
          openDialog(() => {
            setRestoreReason("");
            setRestoreDialogOpen(true);
          })
        }
        onRefund={openRefundDialog}
      />

      {/* 宽屏左 3 / 右 2，窄屏单栏；任务卡永远在最上（§3.8）。 */}
      <div className="grid min-w-0 grid-cols-1 items-start gap-xl xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 gap-xl">
          <DeclarationSection order={order} />
          <AmountsSection order={order} />
          <TimelineSection order={order} productLine={productLine} />
        </div>
        <div className="grid min-w-0 gap-xl">
          <OrderInfoSection order={order} />
          <TenantSection order={order} />
          <FulfillmentSection order={order} />
          <RefundSection order={order} />
        </div>
      </div>

      {paymentDialogOpen ? (
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

      {rejectDialogOpen ? (
        <DialogForm
          open
          size="lg"
          title={tPage("dialogs.rejectDeclaration.title")}
          description={
            order.declaredPayment
              ? tPage.rich("dialogs.rejectDeclaration.descriptionWithAmount", {
                  orderNo: order.orderNo,
                  amount: formatOrderAmount(
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
          <Field>
            <FieldLabel
              htmlFor="vx-order-reject-reason"
              required
              requiredLabel={tPage("confirmDialog.required")}
              hint={tPage("dialogs.rejectDeclaration.reasonHint")}
            >
              {tPage("dialogs.rejectDeclaration.reasonLabel")}
            </FieldLabel>
            <Textarea
              id="vx-order-reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder={tPage("dialogs.rejectDeclaration.placeholder")}
              maxLength={512}
              rows={3}
              autoFocus
            />
          </Field>
          <FieldError>{operationError}</FieldError>
        </DialogForm>
      ) : null}

      {/* create 这一档**还没有**退款单（它要创建的就是那一张），所以条件不能只看
          order.refund——照抄会让按钮点了没反应，比灰着更糟。 */}
      {refundDialog && (refund || refundDialog === "create") ? (
        <DialogForm
          open
          size="lg"
          title={
            refundDialog === "approve"
              ? tPage("dialogs.refund.titleApprove")
              : refundDialog === "reject"
                ? tPage("dialogs.refund.titleReject")
                : refundDialog === "fail"
                  ? tPage("dialogs.refund.titleFail")
                  : refundDialog === "create"
                    ? tPage("dialogs.refund.titleCreate")
                    : tPage("dialogs.refund.titleComplete")
          }
          description={
            /* 按 refund 本身判而不是按模式判：两者等价（只有 create 这一档没有
               退款单），但这样写 TypeScript 能在另一支里收窄，不必上非空断言。 */
            !refund
              ? tPage.rich("dialogs.refund.descCreate", {
                  amount: formatOrderAmount(order.amount, order.currency),
                  b: (chunks) => <strong>{chunks}</strong>,
                })
              : tPage.rich(
                  `dialogs.refund.desc${
                    refundDialog === "execute"
                      ? "Complete"
                      : refundDialog === "fail"
                        ? "Fail"
                        : refundDialog === "approve"
                          ? "Approve"
                          : "Reject"
                  }${refund.reason ? "WithReason" : ""}`,
                  {
                    refundNo: refund.refundNo,
                    amount: formatOrderAmount(refund.amount, order.currency),
                    ...(refund.reason ? { reason: refund.reason } : {}),
                    b: (chunks) => <strong>{chunks}</strong>,
                  },
                )
          }
          submitLabel={
            refundDialog === "approve"
              ? tPage("dialogs.refund.submitApprove")
              : refundDialog === "reject"
                ? tPage("dialogs.refund.submitReject")
                : refundDialog === "fail"
                  ? tPage("dialogs.refund.submitFail")
                  : refundDialog === "create"
                    ? tPage("dialogs.refund.submitCreate")
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
          <Field>
            <FieldLabel
              htmlFor="vx-order-refund-remark"
              required
              requiredLabel={tPage("confirmDialog.required")}
              hint={
                refundDialog === "reject"
                  ? tPage("dialogs.refund.remarkHintCustomer")
                  : tPage("dialogs.refund.remarkHint")
              }
            >
              {tPage("dialogs.refund.remarkLabel")}
            </FieldLabel>
            <Textarea
              id="vx-order-refund-remark"
              value={refundRemark}
              onChange={(event) => setRefundRemark(event.target.value)}
              placeholder={
                refundDialog === "execute"
                  ? tPage("dialogs.refund.placeholderComplete")
                  : refundDialog === "fail"
                    ? tPage("dialogs.refund.placeholderFail")
                    : refundDialog === "create"
                      ? tPage("dialogs.refund.placeholderCreate")
                      : tPage("dialogs.refund.placeholderReview")
              }
              maxLength={512}
              rows={3}
              autoFocus
            />
          </Field>
          <FieldError>{operationError}</FieldError>
        </DialogForm>
      ) : null}

      {voidDialogOpen ? (
        <DialogForm
          open
          size="lg"
          danger
          title={tPage("dialogs.voidOrder.title")}
          description={
            order.tenantName
              ? tPage.rich("dialogs.voidOrder.descriptionWithTenant", {
                  orderNo: order.orderNo,
                  tenantName: order.tenantName,
                  b: (chunks) => <strong>{chunks}</strong>,
                })
              : tPage.rich("dialogs.voidOrder.description", {
                  orderNo: order.orderNo,
                  b: (chunks) => <strong>{chunks}</strong>,
                })
          }
          submitLabel={tPage("dialogs.voidOrder.submitLabel")}
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
          <Field>
            <FieldLabel
              htmlFor="vx-order-void-reason"
              required
              requiredLabel={tPage("confirmDialog.required")}
              hint={tPage("dialogs.voidOrder.reasonHint")}
            >
              {tPage("dialogs.voidOrder.reasonLabel")}
            </FieldLabel>
            <Textarea
              id="vx-order-void-reason"
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              rows={3}
              placeholder={tPage("dialogs.voidOrder.placeholder")}
              autoFocus
            />
          </Field>
          <FieldError>{operationError}</FieldError>
        </DialogForm>
      ) : null}

      {restoreDialogOpen ? (
        <DialogForm
          open
          size="lg"
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
          <Field>
            <FieldLabel
              htmlFor="vx-order-restore-reason"
              required
              requiredLabel={tPage("confirmDialog.required")}
              hint={tPage("dialogs.restoreOrder.reasonHint")}
            >
              {tPage("dialogs.restoreOrder.reasonLabel")}
            </FieldLabel>
            <Textarea
              id="vx-order-restore-reason"
              value={restoreReason}
              onChange={(event) => setRestoreReason(event.target.value)}
              rows={3}
              placeholder={tPage("dialogs.restoreOrder.placeholder")}
              autoFocus
            />
          </Field>
          <FieldError>{operationError}</FieldError>
        </DialogForm>
      ) : null}
    </DetailPageTemplate>
  );
}
