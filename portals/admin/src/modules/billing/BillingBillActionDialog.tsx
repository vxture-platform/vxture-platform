"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Input, Textarea } from "@vxture/design-system";
import type {
  BillingBillAction,
  BillingDetailRecord,
} from "@/entities/console";

type BillingBillActionPayload = {
  action: BillingBillAction;
  reason: string;
  discountAmount?: number | null;
  amount?: number | null;
  itemName?: string | null;
  cycleStartDate?: string | null;
  cycleEndDate?: string | null;
};

export function billingBillActionLabel(action: BillingBillAction) {
  if (action === "cancel") return "作废账单";
  if (action === "discount") return "应收减免";
  if (action === "mark_overdue") return "逾期跟进";
  if (action === "create_adjustment") return "新建调整单";
  return "新建补录单";
}

export function canRunBillingBillAction(
  action: BillingBillAction,
  bill: BillingDetailRecord,
) {
  if (action === "create_adjustment" || action === "create_supplement")
    return true;
  if (bill.billStatus === "cancelled") return false;
  if (action === "cancel")
    return bill.paidAmount <= 0 && bill.invoicedAmount <= 0;
  if (action === "mark_overdue") return bill.billStatus !== "paid";
  return (
    bill.totalAmount > 0 &&
    bill.payableAmount > 0 &&
    bill.payableAmount > bill.paidAmount &&
    bill.payableAmount > bill.invoicedAmount
  );
}

export function billingBillActionDisabledReason(
  action: BillingBillAction,
  bill: BillingDetailRecord,
) {
  if (action === "create_adjustment" || action === "create_supplement")
    return null;
  if (bill.billStatus === "cancelled") return "已作废账单不能继续处理。";
  if (action === "cancel" && bill.paidAmount > 0)
    return "已有收款的账单不能直接作废。";
  if (action === "cancel" && bill.invoicedAmount > 0)
    return "已有有效发票的账单需先完成红冲/作废登记。";
  if (action === "mark_overdue" && bill.billStatus === "paid")
    return "已结清账单不能标记逾期。";
  if (action === "discount" && bill.totalAmount <= 0)
    return "零金额账单不需要应收减免。";
  if (action === "discount" && bill.payableAmount <= bill.paidAmount)
    return "当前应收已不高于已收金额。";
  if (action === "discount" && bill.payableAmount <= bill.invoicedAmount)
    return "当前应收已不高于已开票金额。";
  if (!canRunBillingBillAction(action, bill))
    return "当前账单状态不支持该操作。";
  return null;
}

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: currency || "CNY",
    maximumFractionDigits: 2,
  }).format(value);
}

function localDateValue(value: string | null) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime()))
    return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function actionDescription(action: BillingBillAction) {
  if (action === "cancel")
    return "用于确认为误生成、重复生成或无需追收的账单。已有收款或有效发票时不能直接作废。";
  if (action === "discount")
    return "用于登记线下审批通过的应收减免，只调整账单应收，不处理退款或发票红冲。";
  if (action === "mark_overdue")
    return "用于登记逾期跟进原因，帮助后续催收、展期或客户成功介入。";
  if (action === "create_adjustment")
    return "用于针对当前账单新建一张调整单，承载差额修正、服务变更等运营调整。";
  return "用于补录历史漏计或线下补充确认的应收项目，形成独立补录账单。";
}

function actionIconName(action: BillingBillAction) {
  if (action === "cancel") return "warning";
  if (action === "discount") return "chart-bar";
  if (action === "mark_overdue") return "clock";
  if (action === "create_adjustment") return "edit";
  return "plus";
}

function actionIconClass(action: BillingBillAction) {
  if (action === "cancel") return "vx-subscription-action-dialog__icon--cancel";
  if (action === "discount" || action === "mark_overdue")
    return "vx-subscription-action-dialog__icon--renew";
  if (action === "create_supplement")
    return "vx-subscription-action-dialog__icon--resume";
  return "";
}

function defaultItemName(action: BillingBillAction) {
  if (action === "create_adjustment") return "运营调整项";
  if (action === "create_supplement") return "运营补录项";
  return "";
}

export function BillingBillActionDialog({
  bill,
  action,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  bill: BillingDetailRecord;
  action: BillingBillAction;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: BillingBillActionPayload) => void;
}) {
  const tShared = useTranslations();
  const [reason, setReason] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [amount, setAmount] = useState("");
  const [itemName, setItemName] = useState(defaultItemName(action));
  const [cycleStartDate, setCycleStartDate] = useState(
    localDateValue(bill.cycleStartDate),
  );
  const [cycleEndDate, setCycleEndDate] = useState(
    localDateValue(bill.cycleEndDate),
  );
  const isDiscount = action === "discount";
  const isExceptionBill =
    action === "create_adjustment" || action === "create_supplement";
  const normalizedDiscountAmount = Number(discountAmount);
  const normalizedAmount = Number(amount);
  const maxDiscountAmount = Math.max(
    0,
    Math.min(
      bill.payableAmount,
      bill.payableAmount - bill.paidAmount,
      bill.payableAmount - bill.invoicedAmount,
    ),
  );
  const canSubmit = useMemo(() => {
    if (busy || reason.trim().length < 4) return false;
    if (isDiscount)
      return (
        Number.isFinite(normalizedDiscountAmount) &&
        normalizedDiscountAmount > 0 &&
        normalizedDiscountAmount <= maxDiscountAmount + 0.01
      );
    if (isExceptionBill) {
      return (
        itemName.trim().length >= 2 &&
        Number.isFinite(normalizedAmount) &&
        normalizedAmount > 0 &&
        (!cycleStartDate ||
          !cycleEndDate ||
          new Date(cycleEndDate).getTime() >=
            new Date(cycleStartDate).getTime())
      );
    }
    return true;
  }, [
    busy,
    cycleEndDate,
    cycleStartDate,
    isDiscount,
    isExceptionBill,
    itemName,
    maxDiscountAmount,
    normalizedAmount,
    normalizedDiscountAmount,
    reason,
  ]);

  useEffect(() => {
    setReason("");
    setDiscountAmount("");
    setAmount("");
    setItemName(defaultItemName(action));
    setCycleStartDate(localDateValue(bill.cycleStartDate));
    setCycleEndDate(localDateValue(bill.cycleEndDate));
  }, [action, bill]);

  return (
    <div
      className="vx-subscription-action-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-bill-action-title"
    >
      <form
        className="vx-subscription-action-dialog__panel vx-billing-bill-action-dialog__panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;

          onSubmit({
            action,
            reason: reason.trim(),
            discountAmount: isDiscount
              ? Math.round(normalizedDiscountAmount * 100) / 100
              : null,
            amount: isExceptionBill
              ? Math.round(normalizedAmount * 100) / 100
              : null,
            itemName: isExceptionBill ? itemName.trim() : null,
            cycleStartDate: isExceptionBill ? cycleStartDate : null,
            cycleEndDate: isExceptionBill ? cycleEndDate : null,
          });
        }}
      >
        <header>
          <span
            aria-hidden="true"
            className={`vx-subscription-action-dialog__icon ${actionIconClass(action)}`}
          >
            <Icon
              name={actionIconName(action)}
              size="lg"
              fallback="placeholder"
            />
          </span>
          <div>
            <h2 id="billing-bill-action-title">
              {billingBillActionLabel(action)}
            </h2>
            <p>
              {bill.billNo} · 当前应收{" "}
              {formatCurrency(bill.payableAmount, bill.currency)}
            </p>
          </div>
        </header>
        <p className="vx-subscription-action-dialog__description">
          {actionDescription(action)}
        </p>

        {isDiscount ? (
          <div className="vx-billing-bill-action-dialog__grid">
            <label className="vx-subscription-action-dialog__field">
              <span>减免金额</span>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                max={maxDiscountAmount || undefined}
                value={discountAmount}
                onChange={(event) => setDiscountAmount(event.target.value)}
                placeholder={`最高 ${formatCurrency(maxDiscountAmount, bill.currency)}`}
              />
            </label>
            <label className="vx-subscription-action-dialog__field">
              <span>减免后应收</span>
              <Input
                value={formatCurrency(
                  Math.max(
                    0,
                    bill.payableAmount -
                      (Number.isFinite(normalizedDiscountAmount)
                        ? normalizedDiscountAmount
                        : 0),
                  ),
                  bill.currency,
                )}
                readOnly
              />
            </label>
          </div>
        ) : null}

        {isExceptionBill ? (
          <div className="vx-billing-bill-action-dialog__grid">
            <label className="vx-subscription-action-dialog__field">
              <span>账单项目</span>
              <Input
                value={itemName}
                onChange={(event) => setItemName(event.target.value)}
                maxLength={128}
              />
            </label>
            <label className="vx-subscription-action-dialog__field">
              <span>账单金额</span>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </label>
            <label className="vx-subscription-action-dialog__field">
              <span>账期开始</span>
              <Input
                type="date"
                value={cycleStartDate}
                onChange={(event) => setCycleStartDate(event.target.value)}
              />
            </label>
            <label className="vx-subscription-action-dialog__field">
              <span>账期结束</span>
              <Input
                type="date"
                value={cycleEndDate}
                onChange={(event) => setCycleEndDate(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <label className="vx-subscription-action-dialog__field">
          <span>{action === "mark_overdue" ? "跟进原因" : "处理说明"}</span>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              action === "mark_overdue"
                ? "例如：客户预算审批延期，预计下周完成线下付款。"
                : "请填写线下审批依据、处理原因或财务备注。"
            }
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
          <Button type="submit" disabled={!canSubmit}>
            {busy
              ? tShared("status.generic.processing")
              : billingBillActionLabel(action)}
          </Button>
        </footer>
      </form>
    </div>
  );
}
