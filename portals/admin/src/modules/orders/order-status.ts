/**
 * order-status.ts — 订单状态词表（详情页口径）。
 *
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Orders
 *
 * 设计稿 §5：两张页面（订单详情、待办）共用一份「slug → 徽标 / 一句话 / 语气」。
 * 这里只放**映射**，文案在 `orderDetailPage.status.*` 词条里；语气沿用
 * `status-tone.ts` 那一份（列表页也读它），同一个状态在列表与详情颜色不能两样。
 *
 * 列表页（OrdersPage）此刻仍读 `enums.orderStatus.*` 的旧词（「待复核」「已确认」），
 * 与本表的「等你核对」「已开通」不是同一套话——那是下一批的活，本文件先让详情页与
 * 待办页说同一种。
 *
 * 五步进度也由这里派生（`orderStagePlan`）：状态 → 哪几步已完成、当前卡在哪步。
 * 它与词表放在一起，是因为两者回答的是同一个问题（这张单走到哪了），改一处不改
 * 另一处就会出现「徽标说已开通、进度条还停在核对」。
 */

import type { StatusTone } from "@vxture-platform/shared";
import type {
  OrderOperationRecord,
  OrderOperationStatus,
  OrderPaymentStatus,
} from "@/entities/console";
import {
  ORDER_STATUS_TONE,
  PAYMENT_STATUS_TONE,
} from "@/modules/shared/status-tone";

/** 订单态的徽标词条键（`orderDetailPage` 命名空间下的相对键）。 */
export const ORDER_STATUS_LABEL_KEY = {
  pending: "status.order.pending",
  pending_verify: "status.order.pending_verify",
  paid_unprovisioned: "status.order.paid_unprovisioned",
  partial_pending: "status.order.partial_pending",
  confirmed: "status.order.confirmed",
  closed: "status.order.closed",
  refunded: "status.order.refunded",
  overdue: "status.order.overdue",
  abnormal: "status.order.abnormal",
} as const satisfies Record<OrderOperationStatus, string>;

/** 订单态的「一句话」词条键：徽标旁边解释现在是什么局面。 */
export const ORDER_STATUS_HINT_KEY = {
  pending: "status.orderHint.pending",
  pending_verify: "status.orderHint.pending_verify",
  paid_unprovisioned: "status.orderHint.paid_unprovisioned",
  partial_pending: "status.orderHint.partial_pending",
  confirmed: "status.orderHint.confirmed",
  closed: "status.orderHint.closed",
  refunded: "status.orderHint.refunded",
  overdue: "status.orderHint.overdue",
  abnormal: "status.orderHint.abnormal",
} as const satisfies Record<OrderOperationStatus, string>;

/** 支付态的词条键。这是**根**键（`status.orderPayment.*` 早就存在，列表页也在用）。 */
export const PAYMENT_STATUS_LABEL_KEY = {
  not_required: "status.orderPayment.not_required",
  unpaid: "status.orderPayment.unpaid",
  pending: "status.orderPayment.pending",
  pending_verify: "status.orderPayment.pending_verify",
  paid: "status.orderPayment.paid",
  partial: "status.orderPayment.partial",
  failed: "status.orderPayment.failed",
  closed: "status.orderPayment.closed",
  refunding: "status.orderPayment.refunding",
} as const satisfies Record<OrderPaymentStatus, string>;

/** 语气：与列表页同源，不另立一份。 */
export const ORDER_STATUS_TONE_MAP: Record<OrderOperationStatus, StatusTone> =
  ORDER_STATUS_TONE;
export const PAYMENT_STATUS_TONE_MAP: Record<OrderPaymentStatus, StatusTone> =
  PAYMENT_STATUS_TONE;

// ── 五步进度 ────────────────────────────────────────────────────────────────

export type OrderStageId =
  | "placed"
  | "declared"
  | "verify"
  | "confirm"
  | "provision"
  | "refund";

export type OrderStageState = "done" | "current" | "upcoming" | "muted";

export interface OrderStageSpec {
  readonly id: OrderStageId;
  readonly state: OrderStageState;
  /** 只对 current 有意义：等客户是 info、等运营是 warning、出事是 danger。 */
  readonly tone?: StatusTone;
}

const MAIN_STAGES: readonly OrderStageId[] = [
  "placed",
  "declared",
  "verify",
  "confirm",
  "provision",
];

/**
 * 状态 → 五步各自的状态。
 *
 * 「下单」永远已完成（单子存在就下过单了）；已关闭的单其余四步灰掉（muted）而不是
 * 「未开始」——它们不会再开始了。退款一步只在有退款单且没被驳回时挂在末尾。
 */
export function orderStagePlan(
  order: Pick<OrderOperationRecord, "orderStatus" | "refund">,
): OrderStageSpec[] {
  const status = order.orderStatus;
  let current = -1;
  let tone: StatusTone = "info";
  let closed = false;
  switch (status) {
    case "pending":
      current = 1;
      tone = "info";
      break;
    case "pending_verify":
    case "partial_pending":
      current = 2;
      tone = "warning";
      break;
    case "paid_unprovisioned":
      current = 4;
      tone = "info";
      break;
    case "confirmed":
    case "refunded":
      current = MAIN_STAGES.length;
      break;
    case "closed":
      closed = true;
      break;
    case "overdue":
      current = 1;
      tone = "danger";
      break;
    case "abnormal":
      current = 2;
      tone = "danger";
      break;
  }

  const stages: OrderStageSpec[] = MAIN_STAGES.map((id, index) => {
    if (index === 0) return { id, state: "done" };
    if (closed) return { id, state: "muted" };
    if (index < current) return { id, state: "done" };
    if (index === current) return { id, state: "current", tone };
    return { id, state: "upcoming" };
  });

  const refund = order.refund;
  if (refund && refund.auditStatus !== "rejected") {
    if (status === "refunded" || refund.refundStatus === "success") {
      stages.push({ id: "refund", state: "done" });
    } else if (refund.refundStatus === "failed") {
      stages.push({ id: "refund", state: "current", tone: "danger" });
    } else {
      stages.push({
        id: "refund",
        state: "current",
        // 待审核是运营的活（warning）；审核通过等打款是流程在走（info）。
        tone: refund.auditStatus === "pending" ? "warning" : "info",
      });
    }
  }
  return stages;
}
