"use client";
/**
 * SubscriptionRedemptionDialog.tsx - Explicit noncash subscription confirmation.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-20
 */
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { DialogForm } from "@vxture/design-system";
import { useDateFormat } from "@/lib/use-date-format";
import {
  useVoucherContextKey,
  useVoucherPermission,
  useVoucherFlow,
} from "./VoucherClaimDialog";
import {
  previewSubscriptionRedemption,
  redeemSubscriptionVoucher,
  fetchSubscriptionRedemptionResult,
} from "@/api/console-bff";

type DialogProps = {
  voucherId: string;
  onClose: () => void;
  onRedeemed: () => void;
};
// ============================================================================
// The context key resets pending commands and ignores late responses on switches.
// ============================================================================
/** Render a scoped confirmation. @param props - Voucher, close and refresh callbacks. @returns The operation dialog. */
export function SubscriptionRedemptionDialog(props: DialogProps) {
  const identity = useVoucherContextKey();
  const allowed = useVoucherPermission(true);
  if (!allowed) return null;
  return (
    <SubscriptionRedemptionContent
      key={identity + props.voucherId}
      {...props}
    />
  );
}
function SubscriptionRedemptionContent({
  voucherId,
  onClose,
  onRedeemed,
}: DialogProps) {
  const t = useTranslations("vouchersPage.redeem");
  const { fmtDateTime } = useDateFormat();
  const flow = useVoucherFlow({
    preview: () => previewSubscriptionRedemption(voucherId),
    commit: redeemSubscriptionVoucher,
    recover: fetchSubscriptionRedemptionResult,
    onSuccess: onRedeemed,
  });
  const { preview, result, busy, pending, error, load } = flow;
  useEffect(() => {
    void load();
  }, [load]);
  async function submit() {
    if (busy) return;
    if (result) {
      onClose();
      return;
    }
    if (!preview && !pending) {
      await load();
      return;
    }
    await flow.confirm(() => ({
      voucherId,
      idempotencyKey: crypto.randomUUID(),
    }));
  }
  return (
    <DialogForm
      open
      title={t("title")}
      description={t("description")}
      size="sm"
      submitting={busy}
      submitLabel={t(
        result
          ? "close"
          : pending
            ? "retryRequest"
            : preview
              ? "confirm"
              : "retry",
      )}
      cancelLabel={t("close")}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error ? (
        <p role="alert" className="text-danger-text">
          {t(error)}
        </p>
      ) : null}
      {result ? (
        <div role="status">
          <p>{t("success", { number: result.redemptionNo })}</p>
          <p>
            {t("service", {
              start: fmtDateTime(result.startAt),
              end: fmtDateTime(result.endAt),
            })}
          </p>
        </div>
      ) : preview ? (
        <>
          <p className="font-medium">
            {preview.code} · {preview.productName} · {preview.planName} · V
            {preview.versionNo}
          </p>
          <p>
            {t("context", {
              tenant: preview.tenantName,
              workspace: preview.workspaceName,
            })}
          </p>
          <p>{t("term", { days: preview.durationDays })}</p>
          <p>{t("funding")}</p>
          <p>{t("policy")}</p>
          <ul>
            {preview.grants.map((g, index) => (
              <li key={index}>
                {g.productName}
                {g.tier ? ` · ${g.tier}` : ""}
                {g.features.length ? ` · ${g.features.join(", ")}` : ""}
                {Object.entries(g.quota)
                  .map(([metric, value]) => ` · ${metric}: ${String(value)}`)
                  .join("")}
              </li>
            ))}
          </ul>
        </>
      ) : busy ? (
        <p role="status">{t("loading")}</p>
      ) : null}
    </DialogForm>
  );
}
