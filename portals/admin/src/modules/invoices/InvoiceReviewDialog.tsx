"use client";
/**
 * InvoiceReviewDialog.tsx - Review and record actual issuance on the application.
 * @package @vxture/admin
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-10-22
 */
import { useState } from "react";
import {
  Banner,
  DialogForm,
  Field,
  FieldLabel,
  Input,
  Textarea,
} from "@vxture/design-system";
import type { BillingInvoiceLedgerRecord } from "@/entities/console";
import { reviewInvoiceApplication } from "@/api/admin-bff";

// ============================================================================
// Application review and actual issuance form
// ============================================================================
export function InvoiceReviewDialog({
  invoice,
  action,
  onClose,
  onCompleted,
}: {
  invoice: BillingInvoiceLedgerRecord;
  action: "approve" | "reject" | "issue";
  onClose: () => void;
  onCompleted: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [number, setNumber] = useState("");
  const [code, setCode] = useState("");
  const [file, setFile] = useState("");
  const [tax, setTax] = useState("0.00");
  const [issuedAt, setIssuedAt] = useState(
    new Date().toISOString().slice(0, 16),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title =
    action === "approve"
      ? "受理申请"
      : action === "reject"
        ? "驳回申请"
        : "登记实际开具结果";
  return (
    <DialogForm
      open
      size="lg"
      title={title}
      description={`${invoice.invoiceNo} · ${invoice.invoiceTitle} · ${invoice.currency} ${invoice.invoiceAmount}`}
      submitLabel={title}
      cancelLabel="取消"
      submitting={busy}
      submitDisabled={
        !reason.trim() ||
        (action === "issue" && (!number.trim() || !file.trim() || !issuedAt))
      }
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await reviewInvoiceApplication(invoice.id, {
            action,
            reason,
            invoiceElectronicNo: number,
            ...(code ? { invoiceCode: code } : {}),
            invoiceFileUrl: file,
            taxAmount: tax,
            issuedAt: `${issuedAt}:00Z`,
          });
          await onCompleted();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "处理失败,请刷新后重试",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-body-sm">
        {action === "issue"
          ? "请在税务系统实际开具后登记号码和文件。本操作更新原申请，不会调用税务开票服务或新建一张发票。"
          : "核对全部关联账单及提交时的抬头快照后处理。驳回后客户可重新申请。"}
      </p>
      <ul className="grid gap-xs text-body-sm">
        {(
          invoice.bills ?? [
            {
              id: invoice.billId,
              billNo: invoice.billNo,
              amount: String(invoice.invoiceAmount),
            },
          ]
        ).map((bill) => (
          <li key={bill.id}>
            {bill.billNo} · {invoice.currency} {bill.amount}
          </li>
        ))}
      </ul>
      {invoice.companyInfo ? (
        <dl className="grid gap-xs text-body-sm">
          {Object.entries(invoice.companyInfo).map(([key, value]) => (
            <div key={key}>
              <dt>
                {(
                  {
                    title: "抬头",
                    taxNo: "税号",
                    phone: "电话",
                    address: "地址",
                    bankName: "开户行",
                    bankAccount: "开户账号",
                  } as Record<string, string>
                )[key] ?? key}
              </dt>
              <dd>{typeof value === "string" ? value : "—"}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Field>
        <FieldLabel htmlFor="review-reason">处理说明</FieldLabel>
        <Textarea
          id="review-reason"
          value={reason}
          maxLength={512}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {action === "issue" ? (
        <>
          <Field>
            <FieldLabel htmlFor="review-number">实际发票号码</FieldLabel>
            <Input
              id="review-number"
              value={number}
              maxLength={64}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-code">发票代码（可选）</FieldLabel>
            <Input
              id="review-code"
              value={code}
              maxLength={64}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-file">发票文件 HTTPS 地址</FieldLabel>
            <Input
              id="review-file"
              type="url"
              value={file}
              onChange={(e) => setFile(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-tax">税额（价税合计内）</FieldLabel>
            <Input
              id="review-tax"
              inputMode="decimal"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-issued">实际开具时间（UTC）</FieldLabel>
            <Input
              id="review-issued"
              type="datetime-local"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
            />
          </Field>
        </>
      ) : null}
      {error ? <Banner tone="danger" title={error} /> : null}
    </DialogForm>
  );
}
