"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Icon, Input, Textarea } from "@vxture/design-system";
import type {
  BillingInvoiceReceiptAction,
  BillingInvoiceReceiptRecord,
} from "@/entities/console";

export function invoiceReceiptActionLabel(action: BillingInvoiceReceiptAction) {
  if (action === "update_shipping") return "更新寄送";
  if (action === "finish") return "确认完成";
  return "红冲/作废";
}

export function canRunInvoiceReceiptAction(
  action: BillingInvoiceReceiptAction,
  receipt: BillingInvoiceReceiptRecord,
) {
  if (receipt.invoiceStatus === "red" || receipt.invoiceStatus === "rejected")
    return false;
  if (action === "red") return true;
  if (action === "finish")
    return (
      receipt.invoiceStatus === "issued" || receipt.invoiceStatus === "sending"
    );
  return (
    receipt.invoiceStatus === "issued" ||
    receipt.invoiceStatus === "sending" ||
    receipt.invoiceStatus === "finished"
  );
}

export function invoiceReceiptActionDisabledReason(
  action: BillingInvoiceReceiptAction,
  receipt: BillingInvoiceReceiptRecord,
) {
  if (receipt.invoiceStatus === "red") return "已红冲发票不能继续操作。";
  if (receipt.invoiceStatus === "rejected") return "已驳回发票不能继续操作。";
  if (action === "finish" && receipt.invoiceStatus === "finished")
    return "发票已完成。";
  if (!canRunInvoiceReceiptAction(action, receipt))
    return "当前发票状态不支持该操作。";
  return null;
}

function localDateTimeValue(date: Date) {
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function actionDescription(action: BillingInvoiceReceiptAction) {
  if (action === "update_shipping")
    return "记录线下发票的快递公司、快递单号和寄送时间，不调用任何在线开票或物流接口。";
  if (action === "finish")
    return "确认线下发票已完成交付或归档，可选补充快递信息。";
  return "登记线下发票红冲或作废结果；红冲后该发票金额不再计入账单已开票金额。";
}

function actionIconClass(action: BillingInvoiceReceiptAction) {
  if (action === "red") return "vx-subscription-action-dialog__icon--cancel";
  if (action === "finish") return "vx-subscription-action-dialog__icon--resume";
  return "vx-subscription-action-dialog__icon--renew";
}

export function InvoiceReceiptActionDialog({
  receipt,
  action,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  receipt: BillingInvoiceReceiptRecord;
  action: BillingInvoiceReceiptAction;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: {
    action: BillingInvoiceReceiptAction;
    statusRemark: string;
    expressCompany: string | null;
    expressNo: string | null;
    sendAt: string | null;
  }) => void;
}) {
  const tShared = useTranslations();
  const [expressCompany, setExpressCompany] = useState(
    receipt.expressCompany ?? "",
  );
  const [expressNo, setExpressNo] = useState(receipt.expressNo ?? "");
  const [sendAt, setSendAt] = useState(
    localDateTimeValue(receipt.sendAt ? new Date(receipt.sendAt) : new Date()),
  );
  const [statusRemark, setStatusRemark] = useState("");
  const requiresShipping = action === "update_shipping";
  const showsShipping = action === "update_shipping" || action === "finish";
  const canSubmit =
    statusRemark.trim().length >= 4 &&
    (!requiresShipping ||
      (expressCompany.trim().length > 0 && expressNo.trim().length > 0));

  useEffect(() => {
    setExpressCompany(receipt.expressCompany ?? "");
    setExpressNo(receipt.expressNo ?? "");
    setSendAt(
      localDateTimeValue(
        receipt.sendAt ? new Date(receipt.sendAt) : new Date(),
      ),
    );
    setStatusRemark("");
  }, [action, receipt]);

  return (
    <div
      className="vx-subscription-action-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-receipt-action-title"
    >
      <form
        className="vx-subscription-action-dialog__panel vx-invoice-receipt-action-dialog__panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;

          onSubmit({
            action,
            statusRemark: statusRemark.trim(),
            expressCompany: expressCompany.trim() || null,
            expressNo: expressNo.trim() || null,
            sendAt: sendAt ? new Date(sendAt).toISOString() : null,
          });
        }}
      >
        <header>
          <span
            aria-hidden="true"
            className={`vx-subscription-action-dialog__icon ${actionIconClass(action)}`}
          >
            <Icon
              name={
                action === "red"
                  ? "warning"
                  : action === "finish"
                    ? "check"
                    : "key"
              }
              size="lg"
              fallback="placeholder"
            />
          </span>
          <div>
            <h2 id="invoice-receipt-action-title">
              {invoiceReceiptActionLabel(action)}
            </h2>
            <p>
              {receipt.invoiceNo} · {receipt.invoiceTitle}
            </p>
          </div>
        </header>
        <p className="vx-subscription-action-dialog__description">
          {actionDescription(action)}
        </p>
        {showsShipping ? (
          <div className="vx-invoice-receipt-action-dialog__grid">
            <label className="vx-subscription-action-dialog__field">
              <span>快递公司{requiresShipping ? "" : "（可选）"}</span>
              <Input
                value={expressCompany}
                onChange={(event) => setExpressCompany(event.target.value)}
              />
            </label>
            <label className="vx-subscription-action-dialog__field">
              <span>快递单号{requiresShipping ? "" : "（可选）"}</span>
              <Input
                value={expressNo}
                onChange={(event) => setExpressNo(event.target.value)}
              />
            </label>
            <label className="vx-subscription-action-dialog__field">
              <span>寄送时间{requiresShipping ? "" : "（可选）"}</span>
              <Input
                type="datetime-local"
                value={sendAt}
                onChange={(event) => setSendAt(event.target.value)}
              />
            </label>
          </div>
        ) : null}
        <label className="vx-subscription-action-dialog__field">
          <span>{action === "red" ? "红冲/作废说明" : "操作说明"}</span>
          <Textarea
            value={statusRemark}
            onChange={(event) => setStatusRemark(event.target.value)}
            placeholder={
              action === "red"
                ? "例如：财务系统已完成红冲，按线下结果同步登记。"
                : "例如：财务已完成线下处理，按结果同步登记。"
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
          <Button type="submit" disabled={busy || !canSubmit}>
            {busy
              ? tShared("status.generic.processing")
              : invoiceReceiptActionLabel(action)}
          </Button>
        </footer>
      </form>
    </div>
  );
}
