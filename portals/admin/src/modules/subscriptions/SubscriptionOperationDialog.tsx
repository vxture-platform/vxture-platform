"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DialogForm, Icon, Label, Textarea } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import type {
  SubscriptionOperationAction,
  SubscriptionOperationCycle,
  SubscriptionOperationStatus,
} from "@/entities/console";

/*
 * 订阅侧动作与订单侧动作的分工（2026-09-02 重梳，owner 报「按钮逻辑关系不清楚」）：
 *
 *   订单（钱的一侧，/orders）      订阅（权益的一侧，/subscriptions）
 *   ───────────────────────────    ─────────────────────────────────
 *   确认收款  → 记账 + 激活开通     续期确认  → 人工确认已续约，延一个周期
 *   驳回申报  → 退回客户的付款申报   暂停 / 恢复 → 冻结 / 解冻权益
 *   驳回订单  → 作废未付款的订单     取消      → 终态归档
 *
 * 一条「待收款订单」在 metering.subscriptions 里长得像一条暂停的订阅，但它的钱
 * 还没到、权益从未开通：它是订单不是订阅。订阅侧四个动作对它全部不成立——
 * 续期/恢复会把没收钱的单翻成已生效，取消会封死订单侧的「恢复订单」。所以
 * `pendingOrder` 为 true 时四个动作一律禁用，唯一的出口是去订单侧确认收款
 * （服务端 resolveTargetStatus 同样 409 兜底）。
 */
type SubscriptionActionTarget =
  | SubscriptionOperationStatus
  | {
      status: SubscriptionOperationStatus;
      endAt: string | null;
      cycleType?: SubscriptionOperationCycle;
      pendingOrder?: boolean;
    };

/** 待收款订单壳上任何订阅动作的统一禁用理由。 */
export const PENDING_ORDER_REASON =
  "待收款订单尚未确认收款，请在订单管理确认收款或驳回订单。";

export function subscriptionActionLabel(action: SubscriptionOperationAction) {
  if (action === "renew") return "续期确认";
  if (action === "suspend") return "暂停订阅";
  if (action === "resume") return "恢复订阅";
  return "取消订阅";
}

export function subscriptionActionIcon(
  action: SubscriptionOperationAction,
): IconName {
  if (action === "renew") return "clock";
  if (action === "resume") return "check";
  if (action === "cancel") return "x";
  return "warning";
}

export function subscriptionToggleAction(
  status: SubscriptionOperationStatus,
): SubscriptionOperationAction {
  return status === "suspended" ? "resume" : "suspend";
}

export function subscriptionActionDisabledReason(
  action: SubscriptionOperationAction,
  target: SubscriptionActionTarget,
): string | null {
  const status = typeof target === "string" ? target : target.status;
  const endAt = typeof target === "string" ? null : target.endAt;
  const pendingOrder =
    typeof target === "string" ? false : Boolean(target.pendingOrder);

  if (pendingOrder) return PENDING_ORDER_REASON;

  if (action === "renew") {
    return status === "cancelled" ? "已取消订阅为终态，不能续期确认。" : null;
  }

  if (action === "suspend") {
    if (status === "suspended") return "订阅已处于暂停状态。";
    if (status === "cancelled") return "已取消订阅为终态，不能暂停。";
    return null;
  }

  if (action === "resume") {
    if (status !== "suspended") return "只有暂停中的订阅可以恢复。";
    if (isPastEndAt(endAt)) return "暂停订阅已过期，请先做续期确认。";
    return null;
  }

  return status === "cancelled" ? "订阅已取消。" : null;
}

export function canRunSubscriptionAction(
  action: SubscriptionOperationAction,
  target: SubscriptionActionTarget,
) {
  return subscriptionActionDisabledReason(action, target) === null;
}

function isPastEndAt(value: string | null): boolean {
  if (!value) return false;
  const endAt = new Date(value).getTime();
  return Number.isFinite(endAt) && endAt < Date.now();
}

function subscriptionActionDescription(action: SubscriptionOperationAction) {
  if (action === "renew")
    return "人工确认合同、付款或续约审批已生效，系统据此延长当前周期；临期、逾期、暂停订阅会重新进入已生效状态。本动作不记账：新订单的收款请在订单管理「确认收款」。";
  if (action === "suspend")
    return "暂停用于账务、合规或运营风险冻结。暂停后将关闭自动续期，后续可恢复或续期确认。";
  if (action === "resume")
    return "恢复仅用于仍在有效期内的暂停订阅。若订阅已过期，应先做续期确认。";
  return "取消是订阅终态，会关闭自动续期并把到期时间落到当前时间，请确认业务侧已完成归档。";
}

function subscriptionActionPlaceholder(action: SubscriptionOperationAction) {
  if (action === "renew") return "例如：合同已续签，续期周期按当前套餐执行。";
  if (action === "suspend")
    return "例如：合同付款未确认，暂停权益等待运营复核。";
  if (action === "resume") return "例如：付款确认完成，恢复租户订阅权益。";
  return "例如：客户确认不再续约，订阅归档处理。";
}

export function SubscriptionOperationDialog({
  action,
  subscriptionName,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  action: SubscriptionOperationAction;
  subscriptionName: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const tShared = useTranslations();
  const [reason, setReason] = useState("");
  const trimmedReason = reason.trim();

  useEffect(() => {
    setReason("");
  }, [action, subscriptionName]);

  /* 原来是一整套手搓的模态：自己的遮罩、面板、头部、页脚、两个按钮，外加一个
   * 按动作染色的圆形图标。`DialogForm` 把这些全都管了——遮罩与焦点陷阱、Esc 关闭、
   * 提交中的按钮文案、破坏性提交的语义色（`danger`）。
   *
   * 那个染色圆图标不再画：它的信息量与「取消订阅」这四个字重复，而破坏性由
   * `danger` 表达；图标本身留在标题行里，不再自带一层底色。 */
  return (
    <DialogForm
      open
      title={
        <span className="inline-flex items-center gap-sm">
          <Icon
            name={subscriptionActionIcon(action)}
            size="sm"
            fallback="placeholder"
            aria-hidden="true"
          />
          {subscriptionActionLabel(action)}
        </span>
      }
      description={subscriptionName}
      danger={action === "cancel"}
      submitLabel={subscriptionActionLabel(action)}
      cancelLabel={tShared("actions.discard")}
      pendingLabel={tShared("status.generic.processing")}
      submitting={busy}
      submitDisabled={!trimmedReason}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedReason) onSubmit(trimmedReason);
      }}
    >
      <p className="m-0 text-body-sm text-muted-foreground">
        {subscriptionActionDescription(action)}
      </p>
      <Label htmlFor="vx-subscription-action-reason">操作原因</Label>
      <Textarea
        id="vx-subscription-action-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={subscriptionActionPlaceholder(action)}
        maxLength={512}
        autoFocus
      />
      {error ? (
        <p className="m-0 text-body-sm text-destructive-text">{error}</p>
      ) : null}
    </DialogForm>
  );
}
