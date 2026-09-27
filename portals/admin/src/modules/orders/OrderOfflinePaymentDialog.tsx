"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  DialogForm,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  NativeSelect,
  Textarea,
} from "@vxture/design-system";
import { formatDay } from "@vxture-platform/shared";
import type {
  OrderOfflinePaymentType,
  OrderOperationRecord,
} from "@/entities/console";
import { formatOrderAmount } from "@/modules/orders/order-format";

export function remainingOrderAmount(order: OrderOperationRecord) {
  return Math.max(0, order.amount - order.paidAmount);
}

export function canConfirmOrderOfflinePayment(order: OrderOperationRecord) {
  return confirmOfflinePaymentDisabledReasonKey(order) === null;
}

/**
 * 为什么不能确认收款——四档原因码，文案由调用方按自己的词条出
 * （详情页走 `orderDetailPage.disabled.confirm.*`）。
 */
export type ConfirmDisabledReason = "free" | "done" | "closed" | "refunding";

export function confirmOfflinePaymentDisabledReasonKey(
  order: OrderOperationRecord,
): ConfirmDisabledReason | null {
  if (order.amount <= 0 || order.paymentStatus === "not_required")
    return "free";
  if (
    remainingOrderAmount(order) <= 0 ||
    order.paymentStatus === "paid" ||
    order.orderStatus === "confirmed"
  )
    return "done";
  if (order.orderStatus === "closed" || order.paymentStatus === "closed")
    return "closed";
  if (order.paymentStatus === "refunding") return "refunding";
  return null;
}

/**
 * 列表页（OrdersPage）仍消费这份中文；它整页还没抽 i18n，只抽这四句会造出半中英。
 * 详情页已改走 `confirmOfflinePaymentDisabledReasonKey` + 词条；列表页抽完后删本函数。
 */
export function confirmOfflinePaymentDisabledReason(
  order: OrderOperationRecord,
) {
  const key = confirmOfflinePaymentDisabledReasonKey(order);
  if (key === "free") return "免费订单不需要确认收款。";
  if (key === "done") return "订单已完成收款确认。";
  if (key === "closed") return "已关闭订单不能确认收款。";
  if (key === "refunding") return "退款中的订单不能确认收款。";
  return null;
}

function localDateTimeValue(date: Date) {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

/**
 * 确认后订阅大约到什么时候：新订 / 升级从现在起算一个周期，续订从现有到期日顺延。
 * 这是弹窗里的**预告**，真实生效期由履约段写入订阅；一次性周期没有到期日。
 */
function estimateEndAt(order: OrderOperationRecord): Date | null {
  if (order.cycleType === "once") return null;
  const base =
    order.intent === "renew" && order.fulfilledSubscription?.endAt
      ? new Date(order.fulfilledSubscription.endAt)
      : new Date();
  const end = new Date(base.getTime());
  if (order.cycleType === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

export function OrderOfflinePaymentDialog({
  order,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  order: OrderOperationRecord;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: {
    paidAmount: number;
    offlinePayType: OrderOfflinePaymentType;
    payerName: string;
    paidAt: string;
    transactionNo: string | null;
    evidenceUrl: string | null;
    reason: string;
  }) => void;
}) {
  const tShared = useTranslations();
  const tPage = useTranslations("orderDetailPage");
  const locale = useLocale();
  const remainingAmount = useMemo(() => remainingOrderAmount(order), [order]);
  // 已申报的单（product_321 P9）：确认金额锁定为客户申报的现金腿金额——全额确认或驳回，
  // 不接受部分确认。
  const declared = order.declaredPayment;
  const lockedAmount = declared ? declared.amount : remainingAmount;
  const [paidAmount, setPaidAmount] = useState(
    String(lockedAmount || order.amount),
  );
  const [offlinePayType, setOfflinePayType] = useState<OrderOfflinePaymentType>(
    // 申报渠道 bank → bank_transfer；alipay 在 offline_pay_type 里没有专属值 → other。
    declared && declared.channel === "alipay" ? "other" : "bank_transfer",
  );
  const [payerName, setPayerName] = useState(
    declared?.payerName || order.tenantName,
  );
  const [paidAt, setPaidAt] = useState(localDateTimeValue(new Date()));
  const [transactionNo, setTransactionNo] = useState(
    declared?.transactionNo ?? "",
  );
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [reason, setReason] = useState("");
  const normalizedAmount = Number(paidAmount);
  const canSubmit =
    Number.isFinite(normalizedAmount) &&
    normalizedAmount > 0 &&
    (declared
      ? normalizedAmount === declared.amount
      : normalizedAmount <= remainingAmount) &&
    payerName.trim().length > 0 &&
    reason.trim().length >= 4;

  useEffect(() => {
    setPaidAmount(String(lockedAmount || order.amount));
    setPayerName(declared?.payerName || order.tenantName);
    setPaidAt(localDateTimeValue(new Date()));
    setTransactionNo(declared?.transactionNo ?? "");
    setEvidenceUrl("");
    setReason("");
  }, [order, remainingAmount, lockedAmount, declared]);

  const planLabel = [order.servicePlanName, order.tierName]
    .filter(Boolean)
    .join(" · ");
  const endAt = estimateEndAt(order);
  const previewParams = {
    plan: planLabel || order.solutionName,
    date: endAt ? formatDay(endAt, locale, "—") : "—",
    autoRenew: order.autoRenew ? tPage("autoRenew.on") : tPage("autoRenew.off"),
  };
  // 点确认会发生什么（设计稿 §3.2 第三样）：按订单意图各一句，一次性周期没有到期日。
  const preview = !endAt
    ? tPage("confirmDialog.preview.once", previewParams)
    : order.intent === "upgrade"
      ? tPage("confirmDialog.preview.upgrade", previewParams)
      : order.intent === "renew"
        ? tPage("confirmDialog.preview.renew", previewParams)
        : tPage("confirmDialog.preview.new", previewParams);

  return (
    <DialogForm
      open
      size="lg"
      title={
        <span className="inline-flex items-center gap-sm">
          <Icon
            name="check"
            size="sm"
            fallback="placeholder"
            aria-hidden="true"
          />
          {tPage("confirmDialog.title")}
        </span>
      }
      description={
        declared
          ? tPage("confirmDialog.descriptionDeclared", {
              orderNo: order.orderNo,
              amount: formatOrderAmount(declared.amount, order.currency),
            })
          : tPage("confirmDialog.descriptionRemaining", {
              orderNo: order.orderNo,
              amount: formatOrderAmount(remainingAmount, order.currency),
            })
      }
      submitLabel={tPage("confirmDialog.submit")}
      cancelLabel={tShared("actions.discard")}
      pendingLabel={tShared("status.generic.processing")}
      submitting={busy}
      submitDisabled={!canSubmit}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit) return;

        onSubmit({
          paidAmount: Math.round(normalizedAmount * 100) / 100,
          offlinePayType,
          payerName: payerName.trim(),
          paidAt: new Date(paidAt).toISOString(),
          transactionNo: transactionNo.trim() || null,
          evidenceUrl: evidenceUrl.trim() || null,
          reason: reason.trim(),
        });
      }}
    >
      <p className="m-0 text-body-sm font-semibold text-foreground">
        {preview}
      </p>
      <FieldGroup columns={2}>
        <Field>
          <FieldLabel
            htmlFor="vx-order-confirm-amount"
            required
            requiredLabel={tPage("confirmDialog.required")}
          >
            {tPage("confirmDialog.amountLabel")}
          </FieldLabel>
          <Input
            id="vx-order-confirm-amount"
            value={paidAmount}
            onChange={(event) => setPaidAmount(event.target.value)}
            inputMode="decimal"
            readOnly={Boolean(declared)}
          />
          <FieldDescription>
            {declared
              ? tPage("confirmDialog.amountLockedHint")
              : tPage("confirmDialog.amountFreeHint", {
                  amount: formatOrderAmount(remainingAmount, order.currency),
                })}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel
            htmlFor="vx-order-confirm-channel"
            required
            requiredLabel={tPage("confirmDialog.required")}
          >
            {tPage("confirmDialog.channelLabel")}
          </FieldLabel>
          <NativeSelect
            id="vx-order-confirm-channel"
            value={offlinePayType}
            onChange={(event) =>
              setOfflinePayType(event.target.value as OrderOfflinePaymentType)
            }
          >
            <option value="bank_transfer">
              {tPage("confirmDialog.offlinePayType.bank_transfer")}
            </option>
            <option value="cash">
              {tPage("confirmDialog.offlinePayType.cash")}
            </option>
            <option value="other">
              {tPage("confirmDialog.offlinePayType.other")}
            </option>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel
            htmlFor="vx-order-confirm-payer"
            required
            requiredLabel={tPage("confirmDialog.required")}
          >
            {tPage("confirmDialog.payerLabel")}
          </FieldLabel>
          <Input
            id="vx-order-confirm-payer"
            value={payerName}
            onChange={(event) => setPayerName(event.target.value)}
          />
          {declared?.payerName ? (
            <FieldDescription>
              {tPage("confirmDialog.prefilledFromDeclaration")}
            </FieldDescription>
          ) : null}
        </Field>
        <Field>
          <FieldLabel
            htmlFor="vx-order-confirm-paid-at"
            required
            requiredLabel={tPage("confirmDialog.required")}
          >
            {tPage("confirmDialog.paidAtLabel")}
          </FieldLabel>
          <Input
            id="vx-order-confirm-paid-at"
            type="datetime-local"
            value={paidAt}
            onChange={(event) => setPaidAt(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="vx-order-confirm-txn">
            {tPage("confirmDialog.txnLabel")}
          </FieldLabel>
          <Input
            id="vx-order-confirm-txn"
            value={transactionNo}
            onChange={(event) => setTransactionNo(event.target.value)}
            placeholder={tPage("confirmDialog.optional")}
          />
          {declared?.transactionNo ? (
            <FieldDescription>
              {tPage("confirmDialog.prefilledFromDeclaration")}
            </FieldDescription>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="vx-order-confirm-evidence">
            {tPage("confirmDialog.evidenceLabel")}
          </FieldLabel>
          <Input
            id="vx-order-confirm-evidence"
            value={evidenceUrl}
            onChange={(event) => setEvidenceUrl(event.target.value)}
            placeholder={tPage("confirmDialog.optional")}
          />
        </Field>
      </FieldGroup>
      <Field>
        <FieldLabel
          htmlFor="vx-order-confirm-note"
          required
          requiredLabel={tPage("confirmDialog.required")}
          hint={tPage("confirmDialog.noteHint")}
        >
          {tPage("confirmDialog.noteLabel")}
        </FieldLabel>
        <Textarea
          id="vx-order-confirm-note"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={tPage("confirmDialog.notePlaceholder")}
          maxLength={512}
          rows={3}
        />
      </Field>
      <FieldError>{error}</FieldError>
    </DialogForm>
  );
}
