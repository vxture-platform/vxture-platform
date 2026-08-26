"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, Button, Textarea } from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import type {
  SubscriptionOperationAction,
  SubscriptionOperationCycle,
  SubscriptionOperationStatus,
} from "@/entities/console";

type SubscriptionActionTarget =
  | SubscriptionOperationStatus
  | {
      status: SubscriptionOperationStatus;
      endAt: string | null;
      cycleType?: SubscriptionOperationCycle;
    };

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
    return "确认合同、付款或续约审批已生效。系统会延长当前周期；临期、逾期、暂停订阅会重新进入已生效状态。";
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

  return (
    <div
      className="vx-subscription-action-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscription-action-title"
    >
      <form
        className="vx-subscription-action-dialog__panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmedReason) onSubmit(trimmedReason);
        }}
      >
        <header>
          <span
            aria-hidden="true"
            className={`vx-subscription-action-dialog__icon vx-subscription-action-dialog__icon--${action}`}
          >
            <Icon
              name={subscriptionActionIcon(action)}
              size="lg"
              fallback="placeholder"
            />
          </span>
          <div>
            <h2 id="subscription-action-title">
              {subscriptionActionLabel(action)}
            </h2>
            <p>{subscriptionName}</p>
          </div>
        </header>
        <p className="vx-subscription-action-dialog__description">
          {subscriptionActionDescription(action)}
        </p>
        <label className="vx-subscription-action-dialog__field">
          <span>操作原因</span>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={subscriptionActionPlaceholder(action)}
            maxLength={512}
            autoFocus
          />
        </label>
        {error ? (
          <p className="vx-subscription-action-dialog__error">{error}</p>
        ) : null}
        <footer>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {tShared("actions.discard")}
          </Button>
          <Button
            type="submit"
            className={
              action === "cancel"
                ? "vx-subscription-action-button--danger"
                : undefined
            }
            disabled={busy || !trimmedReason}
          >
            {busy
              ? tShared("status.generic.processing")
              : subscriptionActionLabel(action)}
          </Button>
        </footer>
      </form>
    </div>
  );
}
