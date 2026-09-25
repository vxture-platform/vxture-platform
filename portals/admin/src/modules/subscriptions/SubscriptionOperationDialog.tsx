"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DialogForm,
  Icon,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import {
  SUSPENSION_REASONS,
  SUSPENSION_REASON_EXTENDS_TERM,
} from "@vxture-platform/shared";
import type { SuspensionReason } from "@vxture-platform/shared";
import { useSuspensionReasonLabels } from "@/modules/shared/enum-labels";
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
 * 钱的一侧不在 metering.subscriptions：下单只建 billing.orders（product_330），
 * 订阅行只在履约后才存在，所以这里的每一条都是权益实例，四个动作只看订阅态本身。
 */
type SubscriptionActionTarget =
  | SubscriptionOperationStatus
  | {
      status: SubscriptionOperationStatus;
      endAt: string | null;
      /**
       * **有效到期日**（2026-09-25 步骤三）：`endAt` 加上进行中那次暂停已累计的时长。
       * 判「能不能恢复」用它——顺延在恢复时才结算进 `endAt`，照 `endAt` 判会把一条因平台
       * 故障停了一个月的订阅灰掉，而服务端已经放行，控件与规则各说各话。
       * 传不到时退回 `endAt`（老调用点），不至于比现状更差。
       */
      effectiveEndAt?: string | null;
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
  // 恢复的闸门按有效到期日；没给就退回 endAt。
  const endAt =
    typeof target === "string" ? null : (target.effectiveEndAt ?? target.endAt);

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

/*
 * 暂停原因轴（owner 2026-09-25）。值域与「顺不顺延」的派生都来自
 * `@vxture-platform/shared` 的 catalog-domains——它同时对账 DDL 的
 * `chk_subscription_suspensions_reason`，也是 admin-bff 写 `extends_term` 的依据。
 * 这一侧只负责让运营**看见自己选的那一档意味着什么**：暂停期间客户用不了服务，除了他
 * 自己违规，那些天都该在恢复后还给他。
 *
 * 不给默认值是有意的：默认会让顺延（或不顺延）悄悄发生，而运营根本没被问过。
 */
function suspendReasonHint(
  value: SuspensionReason | "",
  t: (key: string) => string,
): string {
  if (value === "") return t("unselected");
  return SUSPENSION_REASON_EXTENDS_TERM[value] ? t("extends") : t("noExtends");
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
  onSubmit: (
    reason: string,
    suspendReason: SuspensionReason | null,
    expectedResumeAt: string | null,
  ) => void;
}) {
  const tShared = useTranslations();
  const tSuspension = useTranslations("subscriptionSuspension");
  const suspensionReasonLabels = useSuspensionReasonLabels();
  const [reason, setReason] = useState("");
  const [suspendReason, setSuspendReason] = useState<SuspensionReason | "">("");
  /* 预计恢复时间：选填。填了客户界面就倒计时，不填只显示已暂停多久——**不拿最长暂停期
     当终点**，那是内部处置阈值，不是对客户的承诺。 */
  const [expectedResumeAt, setExpectedResumeAt] = useState("");
  const trimmedReason = reason.trim();
  /* 暂停必须选原因：它决定恢复后要不要顺延服务期，服务端也会拒掉不带原因的请求。
     在这里也拦一道是为了别让运营填完一段说明再吃一个 400。 */
  const needsSuspendReason = action === "suspend" && suspendReason === "";

  useEffect(() => {
    setReason("");
    setSuspendReason("");
    setExpectedResumeAt("");
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
      submitDisabled={!trimmedReason || needsSuspendReason}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmedReason || needsSuspendReason) return;
        onSubmit(
          trimmedReason,
          suspendReason === "" ? null : suspendReason,
          /* datetime-local 是本地时区的无时区串，转成 ISO 再送——否则同一个「下午三点」
             在服务端会按 UTC 解析，客户看到的倒计时差好几个小时。 */
          expectedResumeAt ? new Date(expectedResumeAt).toISOString() : null,
        );
      }}
    >
      <p className="m-0 text-body-sm text-muted-foreground">
        {subscriptionActionDescription(action)}
      </p>
      {action === "suspend" ? (
        <>
          <Label htmlFor="vx-subscription-suspend-reason">
            {tSuspension("label")}
          </Label>
          <NativeSelect
            id="vx-subscription-suspend-reason"
            value={suspendReason}
            onChange={(event) =>
              setSuspendReason(event.target.value as SuspensionReason | "")
            }
          >
            <option value="">{tSuspension("placeholder")}</option>
            {SUSPENSION_REASONS.map((value) => (
              <option key={value} value={value}>
                {suspensionReasonLabels[value]}
              </option>
            ))}
          </NativeSelect>
          <p className="m-0 text-body-sm text-muted-foreground">
            {suspendReasonHint(suspendReason, tSuspension)}
          </p>
          <Label htmlFor="vx-subscription-expected-resume">
            {tSuspension("expectedResume")}
          </Label>
          <Input
            id="vx-subscription-expected-resume"
            type="datetime-local"
            value={expectedResumeAt}
            onChange={(event) => setExpectedResumeAt(event.target.value)}
          />
          <p className="m-0 text-body-sm text-muted-foreground">
            {tSuspension("expectedResumeHint")}
          </p>
        </>
      ) : null}
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
