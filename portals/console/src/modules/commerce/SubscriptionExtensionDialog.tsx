"use client";
/**
 * SubscriptionExtensionDialog.tsx - Target and service-date confirmation.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-20
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DialogForm, Label, NativeSelect } from "@vxture/design-system";
import { useDateFormat } from "@/lib/use-date-format";
import {
  useVoucherContextKey,
  useVoucherPermission,
  useVoucherFlow,
} from "./VoucherClaimDialog";
import {
  previewSubscriptionExtension,
  extendSubscriptionVoucher,
  fetchSubscriptionExtensionResult,
} from "@/api/console-bff";

type DialogProps = {
  voucherId: string;
  onClose: () => void;
  onExtended: () => void;
};
// ============================================================================
// The context key resets pending commands and ignores late responses on switches.
// ============================================================================
/** Render a scoped confirmation. @param props - Voucher, close and refresh callbacks. @returns The operation dialog. */
export function SubscriptionExtensionDialog(props: DialogProps) {
  const identity = useVoucherContextKey();
  const allowed = useVoucherPermission(true);
  if (!allowed) return null;
  return (
    <SubscriptionExtensionContent key={identity + props.voucherId} {...props} />
  );
}
function SubscriptionExtensionContent({
  voucherId,
  onClose,
  onExtended,
}: DialogProps) {
  const t = useTranslations("vouchersPage.extend");
  const { fmtDateTime } = useDateFormat();
  const flow = useVoucherFlow({
    preview: () => previewSubscriptionExtension(voucherId),
    commit: extendSubscriptionVoucher,
    recover: fetchSubscriptionExtensionResult,
    onSuccess: onExtended,
  });
  const { preview, result, busy, pending, error, load } = flow;
  useEffect(() => {
    void load();
  }, [load]);
  const [selected, setSelected] = useState("");
  const selectedId = selected || preview?.targets[0]?.subscriptionId || "";
  const target = preview?.targets.find(
    (item) => item.subscriptionId === selectedId,
  );
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
    if (!pending && !target) return;
    await flow.confirm(() => {
      if (!target) throw new Error("missing_extension_target");
      return {
        voucherId,
        subscriptionId: target.subscriptionId,
        expectedPlanVersionId: target.planVersionId,
        expectedEndAt: target.previousEndAt,
        idempotencyKey: crypto.randomUUID(),
      };
    });
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
            : target
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
            {result.productName} · {result.planName} · V{result.versionNo}
          </p>
          <p>
            {t("dates", {
              before: fmtDateTime(result.previousEndAt),
              after: fmtDateTime(result.endAt),
            })}
          </p>
        </div>
      ) : preview ? (
        <>
          <p>
            {preview.code} · {t("days", { days: preview.extendDays })}
          </p>
          <p>
            {t("context", {
              tenant: preview.tenantName,
              workspace: preview.workspaceName,
            })}
          </p>
          {preview.targets.length ? (
            <>
              <Label htmlFor="extension-target">{t("target")}</Label>
              <NativeSelect
                id="extension-target"
                value={selectedId}
                disabled={busy || pending}
                onChange={(e) => setSelected(e.target.value)}
              >
                {preview.targets.map((s) => (
                  <option key={s.subscriptionId} value={s.subscriptionId}>
                    {s.productName} · {s.planName} · V{s.versionNo}
                  </option>
                ))}
              </NativeSelect>
              {target ? (
                <p>
                  {t("dates", {
                    before: fmtDateTime(target.previousEndAt),
                    after: fmtDateTime(target.endAt),
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <p role="status">{t("empty")}</p>
          )}
          <p>{t("policy")}</p>
        </>
      ) : busy ? (
        <p role="status">{t("loading")}</p>
      ) : null}
    </DialogForm>
  );
}
