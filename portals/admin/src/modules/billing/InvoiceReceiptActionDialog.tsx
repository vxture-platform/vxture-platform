"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DialogForm,
  Icon,
  Input,
  Label,
  Textarea,
} from "@vxture/design-system";
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
    <DialogForm
      open
      size="md"
      title={
        <span className="inline-flex items-center gap-sm">
          <Icon
            name={
              action === "red"
                ? "warning"
                : action === "finish"
                  ? "check"
                  : "key"
            }
            size="sm"
            fallback="placeholder"
            aria-hidden="true"
          />
          {invoiceReceiptActionLabel(action)}
        </span>
      }
      description={`${receipt.invoiceNo} · ${receipt.invoiceTitle}`}
      danger={action === "red"}
      submitLabel={invoiceReceiptActionLabel(action)}
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
          action,
          statusRemark: statusRemark.trim(),
          expressCompany: expressCompany.trim() || null,
          expressNo: expressNo.trim() || null,
          sendAt: sendAt ? new Date(sendAt).toISOString() : null,
        });
      }}
    >
      <p className="m-0 text-body-sm text-muted-foreground">
        {actionDescription(action)}
      </p>
      {showsShipping ? (
        <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
          <Label htmlFor="vx-receipt-express-company">
            快递公司{requiresShipping ? "" : "（可选）"}
          </Label>
          <Input
            id="vx-receipt-express-company"
            value={expressCompany}
            onChange={(event) => setExpressCompany(event.target.value)}
          />
          <Label htmlFor="vx-receipt-express-no">
            快递单号{requiresShipping ? "" : "（可选）"}
          </Label>
          <Input
            id="vx-receipt-express-no"
            value={expressNo}
            onChange={(event) => setExpressNo(event.target.value)}
          />
          <Label htmlFor="vx-receipt-send-at">
            寄送时间{requiresShipping ? "" : "（可选）"}
          </Label>
          <Input
            id="vx-receipt-send-at"
            type="datetime-local"
            value={sendAt}
            onChange={(event) => setSendAt(event.target.value)}
          />
        </div>
      ) : null}
      <Label htmlFor="vx-receipt-status-remark">
        {action === "red" ? "红冲/作废说明" : "操作说明"}
      </Label>
      <Textarea
        id="vx-receipt-status-remark"
        value={statusRemark}
        onChange={(event) => setStatusRemark(event.target.value)}
        placeholder={
          action === "red"
            ? "例如：财务系统已完成红冲，按线下结果同步登记。"
            : "例如：财务已完成线下处理，按结果同步登记。"
        }
        maxLength={512}
      />
      {error ? (
        <p className="m-0 text-body-sm text-destructive-text">{error}</p>
      ) : null}
    </DialogForm>
  );
}
