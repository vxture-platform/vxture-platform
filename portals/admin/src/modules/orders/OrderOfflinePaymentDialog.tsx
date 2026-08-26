"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Icon,
  Input,
  NativeSelect,
  Textarea,
} from "@vxture/design-system";
import type {
  OrderOfflinePaymentType,
  OrderOperationRecord,
} from "@/entities/console";

export function remainingOrderAmount(order: OrderOperationRecord) {
  return Math.max(0, order.amount - order.paidAmount);
}

export function canConfirmOrderOfflinePayment(order: OrderOperationRecord) {
  if (order.amount <= 0) return false;
  if (remainingOrderAmount(order) <= 0) return false;
  if (order.orderStatus === "confirmed" || order.orderStatus === "closed")
    return false;
  if (
    order.paymentStatus === "not_required" ||
    order.paymentStatus === "paid" ||
    order.paymentStatus === "closed" ||
    order.paymentStatus === "refunding"
  )
    return false;
  return true;
}

export function confirmOfflinePaymentDisabledReason(
  order: OrderOperationRecord,
) {
  if (order.amount <= 0 || order.paymentStatus === "not_required")
    return "免费订单不需要确认收款。";
  if (
    remainingOrderAmount(order) <= 0 ||
    order.paymentStatus === "paid" ||
    order.orderStatus === "confirmed"
  )
    return "订单已完成收款确认。";
  if (order.orderStatus === "closed" || order.paymentStatus === "closed")
    return "已关闭订单不能确认收款。";
  if (order.paymentStatus === "refunding") return "退款中的订单不能确认收款。";
  return null;
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

function localDateTimeValue(date: Date) {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function offlinePaymentTypeLabel(type: OrderOfflinePaymentType) {
  if (type === "bank_transfer") return "银行转账";
  if (type === "cash") return "现金";
  return "其他";
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
  const remainingAmount = useMemo(() => remainingOrderAmount(order), [order]);
  // Declared order (product_321 P9): the amount is LOCKED to the customer's
  // declared cash-leg amount — full-amount-or-reject, no partial acceptance.
  const declared = order.declaredPayment;
  const lockedAmount = declared ? declared.amount : remainingAmount;
  const [paidAmount, setPaidAmount] = useState(
    String(lockedAmount || order.amount),
  );
  const [offlinePayType, setOfflinePayType] = useState<OrderOfflinePaymentType>(
    // declared channel: 'bank' → bank_transfer; 'alipay' has no dedicated
    // offline_pay_type value → 'other'.
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

  return (
    <div
      className="vx-subscription-action-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-payment-dialog-title"
    >
      <form
        className="vx-subscription-action-dialog__panel vx-order-payment-dialog__panel"
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
        <header>
          <span
            aria-hidden="true"
            className="vx-subscription-action-dialog__icon vx-subscription-action-dialog__icon--resume"
          >
            <Icon name="check" size="lg" fallback="placeholder" />
          </span>
          <div>
            <h2 id="order-payment-dialog-title">确认线下收款</h2>
            <p>
              {order.orderNo} ·{" "}
              {declared
                ? `客户申报 ${formatCurrency(declared.amount, order.currency)}`
                : `剩余应收 ${formatCurrency(remainingAmount, order.currency)}`}
            </p>
          </div>
        </header>
        <p className="vx-subscription-action-dialog__description">
          {declared
            ? "客户已申报付款。确认金额锁定为申报金额（全额确认）；实际到账与申报不符时请改用「驳回申报」，由客户重新申报或线下协商。"
            : "仅用于运营人员确认银行转账、现金或其他线下回款。确认金额须等于剩余应收（全额确认）。"}
        </p>
        <div className="vx-order-payment-dialog__grid">
          <label className="vx-subscription-action-dialog__field">
            <span>确认金额{declared ? "（申报锁定）" : ""}</span>
            <Input
              value={paidAmount}
              onChange={(event) => setPaidAmount(event.target.value)}
              inputMode="decimal"
              readOnly={Boolean(declared)}
            />
          </label>
          <label className="vx-subscription-action-dialog__field">
            <span>收款方式</span>
            <NativeSelect
              value={offlinePayType}
              onChange={(event) =>
                setOfflinePayType(event.target.value as OrderOfflinePaymentType)
              }
            >
              {(["bank_transfer", "cash", "other"] as const).map((type) => (
                <option key={type} value={type}>
                  {offlinePaymentTypeLabel(type)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="vx-subscription-action-dialog__field">
            <span>付款方</span>
            <Input
              value={payerName}
              onChange={(event) => setPayerName(event.target.value)}
            />
          </label>
          <label className="vx-subscription-action-dialog__field">
            <span>收款时间</span>
            <Input
              type="datetime-local"
              value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}
            />
          </label>
          <label className="vx-subscription-action-dialog__field">
            <span>流水号</span>
            <Input
              value={transactionNo}
              onChange={(event) => setTransactionNo(event.target.value)}
              placeholder="可选"
            />
          </label>
          <label className="vx-subscription-action-dialog__field">
            <span>凭证地址</span>
            <Input
              value={evidenceUrl}
              onChange={(event) => setEvidenceUrl(event.target.value)}
              placeholder="可选"
            />
          </label>
        </div>
        <label className="vx-subscription-action-dialog__field">
          <span>确认原因</span>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：财务已核对银行回单，确认线下转账到账。"
            maxLength={512}
          />
        </label>
        {error ? (
          <p className="vx-subscription-action-dialog__error">{error}</p>
        ) : null}
        <footer>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {tShared("actions.discard")}
          </Button>
          <Button type="submit" disabled={busy || !canSubmit}>
            {busy ? tShared("status.generic.processing") : "确认收款"}
          </Button>
        </footer>
      </form>
    </div>
  );
}
