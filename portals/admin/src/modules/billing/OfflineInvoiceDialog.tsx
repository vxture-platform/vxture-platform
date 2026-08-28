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
import type {
  BillingInvoiceStatus,
  BillingInvoiceTaxType,
  BillingInvoiceType,
  BillingRecord,
} from "@/entities/console";

export function remainingInvoiceAmount(bill: BillingRecord) {
  // Round to cents — float subtraction error must not reach the amount input.
  return Math.max(
    0,
    Math.round((bill.payableAmount - bill.invoicedAmount) * 100) / 100,
  );
}

export function canSyncOfflineInvoice(bill: BillingRecord) {
  if (bill.billStatus === "cancelled") return false;
  if (bill.payableAmount <= 0) return false;
  return remainingInvoiceAmount(bill) > 0;
}

export function offlineInvoiceDisabledReason(bill: BillingRecord) {
  if (bill.billStatus === "cancelled") return "已取消账单不能登记发票。";
  if (bill.payableAmount <= 0) return "零金额账单不能登记发票。";
  if (remainingInvoiceAmount(bill) <= 0) return "账单已完成开票登记。";
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

function invoiceTypeLabel(type: BillingInvoiceType) {
  if (type === "special_vat") return "增值税专票";
  if (type === "normal_vat") return "增值税普票";
  if (type === "electronic") return "电子发票";
  if (type === "paper") return "纸质发票";
  return "其他";
}

function taxTypeLabel(type: BillingInvoiceTaxType) {
  if (type === "enterprise") return "企业";
  if (type === "individual") return "个人";
  if (type === "government") return "政府/事业单位";
  return "其他";
}

function invoiceStatusLabel(
  status: Extract<BillingInvoiceStatus, "issued" | "sending" | "finished">,
) {
  if (status === "sending") return "寄送中";
  if (status === "finished") return "已完成";
  return "已开票";
}

export function OfflineInvoiceDialog({
  bill,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  bill: BillingRecord;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: {
    invoiceNo: string;
    invoiceType: BillingInvoiceType;
    invoiceTaxType: BillingInvoiceTaxType;
    invoiceTitle: string;
    taxNo: string | null;
    invoiceAmount: number;
    taxAmount: number;
    invoiceStatus: Extract<
      BillingInvoiceStatus,
      "issued" | "sending" | "finished"
    >;
    statusRemark: string;
    invoiceCode: string | null;
    invoiceElectronicNo: string | null;
    invoiceFileUrl: string | null;
    issuedAt: string;
    expressCompany: string | null;
    expressNo: string | null;
    sendAt: string | null;
  }) => void;
}) {
  const tShared = useTranslations();
  const remainingAmount = remainingInvoiceAmount(bill);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceType, setInvoiceType] =
    useState<BillingInvoiceType>("normal_vat");
  const [invoiceTaxType, setInvoiceTaxType] =
    useState<BillingInvoiceTaxType>("enterprise");
  const [invoiceTitle, setInvoiceTitle] = useState(bill.tenantName);
  const [taxNo, setTaxNo] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState(
    String(remainingAmount || bill.payableAmount),
  );
  const [taxAmount, setTaxAmount] = useState("0");
  const [invoiceStatus, setInvoiceStatus] =
    useState<Extract<BillingInvoiceStatus, "issued" | "sending" | "finished">>(
      "issued",
    );
  const [invoiceCode, setInvoiceCode] = useState("");
  const [invoiceElectronicNo, setInvoiceElectronicNo] = useState("");
  const [invoiceFileUrl, setInvoiceFileUrl] = useState("");
  const [issuedAt, setIssuedAt] = useState(localDateTimeValue(new Date()));
  const [expressCompany, setExpressCompany] = useState("");
  const [expressNo, setExpressNo] = useState("");
  const [sendAt, setSendAt] = useState("");
  const [statusRemark, setStatusRemark] = useState("");
  const normalizedAmount = Number(invoiceAmount);
  const normalizedTaxAmount = Number(taxAmount);
  const canSubmit =
    invoiceNo.trim().length > 0 &&
    invoiceTitle.trim().length > 0 &&
    Number.isFinite(normalizedAmount) &&
    normalizedAmount > 0 &&
    normalizedAmount <= remainingAmount &&
    Number.isFinite(normalizedTaxAmount) &&
    normalizedTaxAmount >= 0 &&
    statusRemark.trim().length >= 4;

  useEffect(() => {
    setInvoiceNo("");
    setInvoiceTitle(bill.tenantName);
    setTaxNo("");
    setInvoiceAmount(
      String(remainingInvoiceAmount(bill) || bill.payableAmount),
    );
    setTaxAmount("0");
    setInvoiceStatus("issued");
    setInvoiceCode("");
    setInvoiceElectronicNo("");
    setInvoiceFileUrl("");
    setIssuedAt(localDateTimeValue(new Date()));
    setExpressCompany("");
    setExpressNo("");
    setSendAt("");
    setStatusRemark("");
  }, [bill]);

  return (
    <DialogForm
      open
      size="lg"
      title={
        <span className="inline-flex items-center gap-sm">
          <Icon
            name="key"
            size="sm"
            fallback="placeholder"
            aria-hidden="true"
          />
          登记线下发票
        </span>
      }
      description={`${bill.billNo} · 剩余可开票 ${formatCurrency(remainingAmount, bill.currency)}`}
      submitLabel="同步登记"
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
          invoiceNo: invoiceNo.trim(),
          invoiceType,
          invoiceTaxType,
          invoiceTitle: invoiceTitle.trim(),
          taxNo: taxNo.trim() || null,
          invoiceAmount: Math.round(normalizedAmount * 100) / 100,
          taxAmount: Math.round(normalizedTaxAmount * 100) / 100,
          invoiceStatus,
          statusRemark: statusRemark.trim(),
          invoiceCode: invoiceCode.trim() || null,
          invoiceElectronicNo: invoiceElectronicNo.trim() || null,
          invoiceFileUrl: invoiceFileUrl.trim() || null,
          issuedAt: new Date(issuedAt).toISOString(),
          expressCompany: expressCompany.trim() || null,
          expressNo: expressNo.trim() || null,
          sendAt: sendAt ? new Date(sendAt).toISOString() : null,
        });
      }}
    >
      <p className="m-0 text-body-sm text-muted-foreground">
        仅记录线下已处理的发票结果，不调用在线开票接口。登记后会更新账单的开票进度和发票记录。
      </p>
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <Label>发票号码</Label>
        <Input
          value={invoiceNo}
          onChange={(event) => setInvoiceNo(event.target.value)}
        />
        <Label>发票类型</Label>
        <NativeSelect
          value={invoiceType}
          onChange={(event) =>
            setInvoiceType(event.target.value as BillingInvoiceType)
          }
        >
          {(
            [
              "special_vat",
              "normal_vat",
              "electronic",
              "paper",
              "other",
            ] as const
          ).map((type) => (
            <option key={type} value={type}>
              {invoiceTypeLabel(type)}
            </option>
          ))}
        </NativeSelect>
        <Label>抬头类型</Label>
        <NativeSelect
          value={invoiceTaxType}
          onChange={(event) =>
            setInvoiceTaxType(event.target.value as BillingInvoiceTaxType)
          }
        >
          {(["enterprise", "individual", "government", "other"] as const).map(
            (type) => (
              <option key={type} value={type}>
                {taxTypeLabel(type)}
              </option>
            ),
          )}
        </NativeSelect>
        <Label>发票状态</Label>
        <NativeSelect
          value={invoiceStatus}
          onChange={(event) =>
            setInvoiceStatus(
              event.target.value as Extract<
                BillingInvoiceStatus,
                "issued" | "sending" | "finished"
              >,
            )
          }
        >
          {(["issued", "sending", "finished"] as const).map((status) => (
            <option key={status} value={status}>
              {invoiceStatusLabel(status)}
            </option>
          ))}
        </NativeSelect>
        <Label>发票抬头</Label>
        <Input
          value={invoiceTitle}
          onChange={(event) => setInvoiceTitle(event.target.value)}
        />
        <Label>税号</Label>
        <Input
          value={taxNo}
          onChange={(event) => setTaxNo(event.target.value)}
          placeholder="可选"
        />
        <Label>发票金额</Label>
        <Input
          value={invoiceAmount}
          onChange={(event) => setInvoiceAmount(event.target.value)}
          inputMode="decimal"
        />
        <Label>税额</Label>
        <Input
          value={taxAmount}
          onChange={(event) => setTaxAmount(event.target.value)}
          inputMode="decimal"
        />
        <Label>发票代码</Label>
        <Input
          value={invoiceCode}
          onChange={(event) => setInvoiceCode(event.target.value)}
          placeholder="可选"
        />
        <Label>电子票号</Label>
        <Input
          value={invoiceElectronicNo}
          onChange={(event) => setInvoiceElectronicNo(event.target.value)}
          placeholder="可选"
        />
        <Label>开票时间</Label>
        <Input
          type="datetime-local"
          value={issuedAt}
          onChange={(event) => setIssuedAt(event.target.value)}
        />
        <Label>发票文件</Label>
        <Input
          value={invoiceFileUrl}
          onChange={(event) => setInvoiceFileUrl(event.target.value)}
          placeholder="可选 URL"
        />
        <Label>快递公司</Label>
        <Input
          value={expressCompany}
          onChange={(event) => setExpressCompany(event.target.value)}
          placeholder="可选"
        />
        <Label>快递单号</Label>
        <Input
          value={expressNo}
          onChange={(event) => setExpressNo(event.target.value)}
          placeholder="可选"
        />
        <Label>寄送时间</Label>
        <Input
          type="datetime-local"
          value={sendAt}
          onChange={(event) => setSendAt(event.target.value)}
        />
      </div>
      <Label>登记说明</Label>
      <Textarea
        value={statusRemark}
        onChange={(event) => setStatusRemark(event.target.value)}
        placeholder="例如：财务已在线下开具发票，按发票系统结果同步登记。"
        maxLength={512}
      />
      {error ? (
        <p className="m-0 text-body-sm text-destructive-text">{error}</p>
      ) : null}
    </DialogForm>
  );
}
