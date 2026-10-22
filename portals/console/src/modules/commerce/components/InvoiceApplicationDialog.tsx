"use client";
/**
 * InvoiceApplicationDialog.tsx - Confirm the complete set of selected bills.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-10-22
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Banner,
  Button,
  DialogForm,
  Field,
  FieldLabel,
  NativeSelect,
} from "@vxture/design-system";
import {
  applyInvoiceReceipt,
  fetchBillingAddresses,
  fetchTenantVerification,
  type ConsoleBill,
  type ConsoleBillingAddress,
} from "@/api/console-bff";
import { useRouter } from "@/lib/i18n/navigation";

// ============================================================================
// Application form
// ============================================================================
export function InvoiceApplicationDialog({
  bills,
  onClose,
  onApplied,
}: {
  bills: ConsoleBill[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const t = useTranslations("billingPage.invoicing.application");
  const typeT = useTranslations("billingPage.invoicing.type");
  const router = useRouter();
  const [addresses, setAddresses] = useState<ConsoleBillingAddress[]>([]);
  const [addressId, setAddressId] = useState("");
  const [invoiceType, setInvoiceType] = useState("electronic_general");
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([fetchBillingAddresses(), fetchTenantVerification()])
      .then(([rows, verification]) => {
        if (!active) return;
        setAddresses(rows);
        setVerified(verification.canIssueInvoice);
        const first = rows.find((r) => r.isDefault) ?? rows[0];
        if (first) {
          setAddressId(first.id);
          setInvoiceType(
            first.invoiceTaxType === "special"
              ? "electronic_special"
              : "electronic_general",
          );
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : t("failed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);
  const address = addresses.find((r) => r.id === addressId);
  return (
    <DialogForm
      open
      size="lg"
      title={t("title")}
      description={t("rules")}
      submitLabel={t("submit")}
      cancelLabel={t("cancel")}
      submitting={busy}
      submitDisabled={
        loading ||
        !verified ||
        !address ||
        bills.length < 1 ||
        bills.length > 50
      }
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || loading || !verified || !address) return;
        setBusy(true);
        setError(null);
        try {
          await applyInvoiceReceipt({
            billIds: bills.map((b) => b.id),
            addressId,
            invoiceType,
          });
          onApplied();
        } catch (err) {
          setError(err instanceof Error ? err.message : t("failed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>{t("selected", { count: bills.length })}</p>
      <ul className="grid gap-xs text-body-sm">
        {bills.map((b) => (
          <li key={b.id}>
            {b.billNo} · {b.billCycle} · {b.currency} {b.payableAmount}
          </li>
        ))}
      </ul>
      <p className="text-body-sm">
        {t("total", {
          amount: sumAmounts(bills.map((b) => b.payableAmount)),
          currency: bills[0]?.currency ?? "",
        })}
      </p>
      {!loading && !verified ? (
        <Banner tone="warning" title={t("verificationRequired")} />
      ) : null}
      {error ? <Banner tone="danger" title={error} /> : null}
      {!loading && !addresses.length ? (
        <Button
          variant="outline"
          onClick={() => router.push("/billing/invoices")}
        >
          {t("manageAddresses")}
        </Button>
      ) : null}
      <Field>
        <FieldLabel htmlFor="invoice-address">{t("address")}</FieldLabel>
        <NativeSelect
          id="invoice-address"
          value={addressId}
          disabled={busy || loading}
          onChange={(event) => {
            setAddressId(event.target.value);
            const next = addresses.find((r) => r.id === event.target.value);
            setInvoiceType(
              next?.invoiceTaxType === "special"
                ? "electronic_special"
                : "electronic_general",
            );
          }}
        >
          <option value="">{t("chooseAddress")}</option>
          {addresses.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel htmlFor="invoice-type">{t("type")}</FieldLabel>
        <NativeSelect
          id="invoice-type"
          value={invoiceType}
          disabled={busy}
          onChange={(event) => setInvoiceType(event.target.value)}
        >
          {(address?.invoiceTaxType === "special"
            ? ["electronic_special", "paper_special"]
            : ["electronic_general"]
          ).map((type) => (
            <option key={type} value={type}>
              {typeT(type)}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </DialogForm>
  );
}

/** Sum the preview without floating point; the server independently recalculates it. */
function sumAmounts(amounts: string[]): string {
  const cents = amounts.reduce(
    (sum, amount) => sum + BigInt(amount.replace(".", "")),
    0n,
  );
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
