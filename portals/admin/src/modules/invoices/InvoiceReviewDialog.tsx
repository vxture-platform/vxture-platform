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
import { useTranslations } from "next-intl";
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
  const t = useTranslations("invoiceReview");
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
  const title = t(action);
  return (
    <DialogForm
      open
      size="lg"
      title={title}
      description={`${invoice.invoiceNo} · ${invoice.invoiceTitle} · ${invoice.currency} ${invoice.invoiceAmount}`}
      submitLabel={title}
      cancelLabel={t("cancel")}
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
          setError(err instanceof Error ? err.message : t("failed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-body-sm">
        {t(action === "issue" ? "issueNotice" : "reviewNotice")}
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
          {(
            [
              "title",
              "taxNo",
              "phone",
              "address",
              "bankName",
              "bankAccount",
            ] as const
          ).map((key) => (
            <div key={key}>
              <dt>{t(`company.${key}`)}</dt>
              <dd>
                {typeof invoice.companyInfo?.[key] === "string"
                  ? invoice.companyInfo[key]
                  : "—"}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <Field>
        <FieldLabel htmlFor="review-reason">{t("reason")}</FieldLabel>
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
            <FieldLabel htmlFor="review-number">{t("number")}</FieldLabel>
            <Input
              id="review-number"
              value={number}
              maxLength={64}
              onChange={(e) => setNumber(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-code">{t("code")}</FieldLabel>
            <Input
              id="review-code"
              value={code}
              maxLength={64}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-file">{t("file")}</FieldLabel>
            <Input
              id="review-file"
              type="url"
              value={file}
              onChange={(e) => setFile(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-tax">{t("tax")}</FieldLabel>
            <Input
              id="review-tax"
              inputMode="decimal"
              value={tax}
              onChange={(e) => setTax(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-issued">{t("issuedAt")}</FieldLabel>
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
