"use client";
/**
 * RechargeCardDialog.tsx - Explicit wallet destination and source-aware receipt.
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
  previewRechargeCard,
  redeemRechargeCard,
  fetchRechargeCardResult,
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
export function RechargeCardDialog(props: DialogProps) {
  const identity = useVoucherContextKey();
  const allowed = useVoucherPermission(true);
  if (!allowed) return null;
  return <RechargeCardContent key={identity + props.voucherId} {...props} />;
}
function RechargeCardContent({ voucherId, onClose, onRedeemed }: DialogProps) {
  const t = useTranslations("vouchersPage.recharge");
  const { fmtDateTime } = useDateFormat();
  const flow = useVoucherFlow({
    preview: () => previewRechargeCard(voucherId),
    commit: redeemRechargeCard,
    recover: fetchRechargeCardResult,
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
    await flow.confirm((current) => ({
      voucherId,
      confirmation: current.confirmation,
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
        <div role="status" className="space-y-3">
          <p>{t("success", { number: result.redemptionNo })}</p>
          <p>
            {t("amounts", {
              principal: result.principal,
              bonus: result.bonus,
              currency: result.currency,
            })}
          </p>
          <p>
            {t("balance", {
              balance: result.balance,
              currency: result.currency,
            })}
          </p>
          <p>
            {result.bonusExpiresAt
              ? t("expires", { date: fmtDateTime(result.bonusExpiresAt) })
              : t("noExpiry")}
          </p>
          <p>
            {t("transactions", { numbers: result.transactions.join(" · ") })}
          </p>
        </div>
      ) : preview ? (
        <div className="space-y-3">
          <p>{preview.code}</p>
          <p>
            {t("context", {
              tenant: preview.tenantName,
              workspace: preview.workspaceName,
            })}
          </p>
          <p>
            {t("amounts", {
              principal: preview.principal,
              bonus: preview.bonus,
              currency: preview.currency,
            })}
          </p>
          <p>
            {preview.bonusExpiresInDays
              ? t("days", { days: preview.bonusExpiresInDays })
              : t("noExpiry")}
          </p>
          <p>{t("policy")}</p>
        </div>
      ) : null}
    </DialogForm>
  );
}
