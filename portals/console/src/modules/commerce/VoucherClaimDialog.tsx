"use client";
/**
 * VoucherClaimDialog.tsx - Confidential preview followed by explicit ownership confirmation.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-20
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { DialogForm, Input, Label, NativeSelect } from "@vxture/design-system";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useDateFormat } from "@/lib/use-date-format";
import {
  ConsoleBffError,
  previewVoucherClaim,
  claimVoucher,
  fetchVoucherClaimResult,
  type ConsoleVoucherClaimPreview,
} from "@/api/console-bff";

// ============================================================================
// Shared lifecycle: immutable commands and scoped, recoverable receipts.
// ============================================================================
/** Identify the authenticated destination and permissions without browser storage.
 * @returns A remount key for sensitive voucher dialogs.
 */
export function useVoucherContextKey(): string {
  const { session } = useConsoleSession();
  return JSON.stringify([
    session.isAuthenticated,
    session.user?.id,
    session.tenant?.id,
    session.tenant?.workspace,
    [...session.capabilities].sort(),
  ]);
}

/** Check the current scoped session before mounting a voucher operation.
 * @param manage - Whether billing write permission is required.
 * @returns Whether the operation can be shown in the current context.
 */
export function useVoucherPermission(manage = false): boolean {
  const { session } = useConsoleSession();
  return !!(
    session.isAuthenticated &&
    session.user &&
    session.tenant?.id &&
    session.tenant.workspace &&
    (!manage || session.capabilities.includes("tenant.billing.manage"))
  );
}

type FlowError =
  | "previewFailed"
  | "failed"
  | "changed"
  | "rateLimited"
  | "unavailable";
/** Share mutation lifecycle across voucher confirmations, without sharing secrets.
 * @param options - Scoped preview, commit, receipt lookup and refresh callback.
 * @returns Stable preview/confirm controls and presentation state.
 */
export function useVoucherFlow<
  P,
  C extends { idempotencyKey: string },
  R,
>(options: {
  preview: () => Promise<P>;
  commit: (command: C) => Promise<R>;
  recover: (key: string) => Promise<R | null>;
  onSuccess: (receipt: R) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const live = useRef(true),
    locked = useRef(false);
  const previewRef = useRef<P | null>(null),
    command = useRef<C | null>(null),
    completed = useRef(false);
  const [preview, setPreview] = useState<P | null>(null),
    [result, setResult] = useState<R | null>(null);
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState(false);
  const [error, setError] = useState<FlowError | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      previewRef.current = null;
      command.current = null;
    };
  }, []);
  const reset = useCallback(() => {
    if (locked.current || (command.current && !completed.current)) return false;
    previewRef.current = null;
    setPreview(null);
    setError(null);
    return true;
  }, []);
  const load = useCallback(async () => {
    if (!live.current || locked.current || command.current || completed.current)
      return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const request = latest.current;
    try {
      const next = await request.preview();
      if (live.current) {
        previewRef.current = next;
        setPreview(next);
      }
    } catch {
      if (live.current) setError("previewFailed");
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }, []);
  const confirm = useCallback(async (build: (preview: P) => C) => {
    if (
      !live.current ||
      locked.current ||
      completed.current ||
      (!previewRef.current && !command.current)
    )
      return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const request = latest.current;
    const succeed = (receipt: R) => {
      if (!live.current) return;
      completed.current = true;
      command.current = null;
      previewRef.current = null;
      setResult(receipt);
      setPending(false);
      request.onSuccess(receipt);
    };
    try {
      if (command.current) {
        // An explicit retry looks up the old receipt before resending the same command.
        const receipt = await request.recover(command.current.idempotencyKey);
        if (!live.current) return;
        if (receipt) {
          succeed(receipt);
          return;
        }
      } else if (previewRef.current) {
        command.current = build(previewRef.current);
      }
      if (!command.current || !live.current) return;
      const original = command.current;
      setPending(true);
      try {
        succeed(await request.commit(original));
      } catch (failure) {
        if (!live.current) return;
        // Lookup is read-only; a failed write is never automatically repeated.
        try {
          const receipt = await request.recover(original.idempotencyKey);
          if (!live.current) return;
          if (receipt) {
            succeed(receipt);
            return;
          }
          if (
            failure instanceof ConsoleBffError &&
            [400, 409].includes(failure.status ?? 0)
          ) {
            command.current = null;
            previewRef.current = null;
            setPreview(null);
            setPending(false);
            setError("changed");
            return;
          }
        } catch {
          if (!live.current) return;
        }
        setError(
          failure instanceof ConsoleBffError && failure.status === 429
            ? "rateLimited"
            : failure instanceof ConsoleBffError && failure.status === 503
              ? "unavailable"
              : "failed",
        );
      }
    } catch {
      if (live.current) setError("failed");
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }, []);
  return { preview, result, busy, pending, error, load, confirm, reset };
}

// ============================================================================
// Claim credentials stay only in this scoped component's memory.
// ============================================================================
type ClaimProps = { onClose: () => void; onClaimed: () => void };
/** Render a scoped claim ceremony. @param props - Close and refresh callbacks. @returns The claim dialog. */
export function VoucherClaimDialog(props: ClaimProps) {
  const identity = useVoucherContextKey();
  const allowed = useVoucherPermission();
  if (!allowed) return null;
  return <VoucherClaimContent key={identity} {...props} />;
}
function VoucherClaimContent({ onClose, onClaimed }: ClaimProps) {
  const t = useTranslations("vouchersPage.claim");
  const { fmtDateTime } = useDateFormat();
  const [secret, setSecret] = useState(""),
    [target, setTarget] = useState<"user" | "workspace">("user");
  const flow = useVoucherFlow({
    preview: () => previewVoucherClaim(secret.trim(), target),
    commit: claimVoucher,
    recover: fetchVoucherClaimResult,
    onSuccess: () => {
      setSecret("");
      onClaimed();
    },
  });
  const { preview, result, busy, pending, error } = flow;
  const close = () => {
    if (!busy) {
      setSecret("");
      onClose();
    }
  };
  async function submit() {
    if (busy) return;
    if (result) {
      close();
      return;
    }
    if (!preview && !pending) {
      if (secret.trim()) await flow.load();
      return;
    }
    await flow.confirm(() => ({
      secret: secret.trim(),
      target,
      idempotencyKey: crypto.randomUUID(),
    }));
  }
  function effectText(p: ConsoleVoucherClaimPreview) {
    if (p.kind === "recharge_card")
      return t("recharge", {
        principal: p.recharge?.principal ?? "—",
        bonus: p.recharge?.bonus ?? "—",
      });
    const effect = p.effect;
    if (p.kind === "credit_voucher")
      return t("credit", {
        amount: (
          Number(effect.amount_cents ?? effect.amountCents) / 100
        ).toFixed(2),
      });
    if (p.kind === "discount")
      return effect.discount_type === "percent" ||
        effect.discountType === "percent"
        ? t("percent", { value: Number(effect.value) })
        : t("fixed", { amount: (Number(effect.value) / 100).toFixed(2) });
    if (p.kind === "redemption")
      return t("redemption", { days: Number(effect.duration_days) });
    if (p.kind === "extension")
      return t("extension", { days: Number(effect.extend_days) });
    return t("invite");
  }

  // =========================================================================
  // Both buttons use the same request identity after a lost confirmation reply.
  // =========================================================================
  return (
    <DialogForm
      open
      title={t("title")}
      description={t("description")}
      size="lg"
      submitLabel={t(
        result
          ? "close"
          : pending
            ? "retryRequest"
            : preview
              ? "confirm"
              : "preview",
      )}
      cancelLabel={t("close")}
      submitting={busy}
      submitDisabled={!result && !pending && !secret.trim()}
      onOpenChange={(open) => {
        if (!open) close();
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
        <p role="status">{t("success", { code: result.code })}</p>
      ) : (
        <>
          <Label htmlFor="voucher-claim-secret">{t("credential")}</Label>
          <Input
            id="voucher-claim-secret"
            type="password"
            autoComplete="off"
            maxLength={100}
            value={secret}
            disabled={busy || pending}
            onChange={(e) => {
              if (flow.reset()) setSecret(e.target.value);
            }}
          />
          <p className="text-body-sm text-muted-foreground">
            {t("credentialHint")}
          </p>
          <Label htmlFor="voucher-claim-target">{t("target")}</Label>
          <NativeSelect
            id="voucher-claim-target"
            value={target}
            disabled={busy || pending}
            onChange={(e) => {
              if (flow.reset())
                setTarget(e.target.value as "user" | "workspace");
            }}
          >
            <option value="user">{t("personal")}</option>
            <option value="workspace">{t("workspace")}</option>
          </NativeSelect>
          {preview ? (
            <>
              <p className="font-medium">
                {preview.batchName} · {preview.code}
              </p>
              <p>{effectText(preview)}</p>
              {(preview.effect.max_off_cents ?? preview.effect.maxOffCents) ? (
                <p>
                  {t("cap", {
                    amount: (
                      Number(
                        preview.effect.max_off_cents ??
                          preview.effect.maxOffCents,
                      ) / 100
                    ).toFixed(2),
                  })}
                </p>
              ) : null}
              <p>
                {t("context", {
                  tenant: preview.tenantName,
                  workspace: preview.workspaceName,
                })}
              </p>
              <p>
                {t("expiry", {
                  date: fmtDateTime(preview.expiresAt),
                })}
              </p>
              <p>
                {preview.useValidDays
                  ? t("relativeDays", { days: preview.useValidDays })
                  : t("batchExpiry")}
              </p>
              <p>
                {t(
                  preview.returnPolicy === "full_reversal_only"
                    ? "returnOnReversal"
                    : "noReturn",
                )}
              </p>
              <p className="text-body-sm text-muted-foreground">
                {t("bindingHint")}
              </p>
            </>
          ) : null}
        </>
      )}
    </DialogForm>
  );
}
