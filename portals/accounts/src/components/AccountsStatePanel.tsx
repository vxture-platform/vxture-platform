/**
 * AccountsStatePanel.tsx - shared, reason-specific account outcomes.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-09
 */
"use client";
import { useTranslations } from "next-intl";
import { Button } from "@vxture/design-system";
import { AccountsNotice } from "./AuthChrome";

// ============================================================================
// Outcome variants
// ============================================================================
export type AccountsState =
  | "loading"
  | "load-error"
  | "session-expired"
  | "link-expired"
  | "not-found"
  | "signed-out"
  | "password-reset"
  | "binding-complete"
  | "mfa-enabled"
  | "recovery-saved"
  | "email-sent"
  | "success";

/** Render a specific outcome and only an action that the caller can actually perform. */
export function AccountsStatePanel({
  state,
  onRetry,
}: {
  readonly state: AccountsState;
  readonly onRetry?: (() => void) | undefined;
}) {
  const t = useTranslations("accountsStates");
  const failed = [
    "load-error",
    "session-expired",
    "link-expired",
    "not-found",
  ].includes(state);
  const neutral = ["loading", "email-sent"].includes(state);
  return (
    <AccountsNotice
      tone={failed ? "danger" : neutral ? "neutral" : "success"}
      title={t(`${state}.title`)}
      description={
        <span role={state === "loading" ? "status" : undefined}>
          {t(`${state}.description`)}
        </span>
      }
      action={
        state === "load-error" && onRetry ? (
          <Button onClick={onRetry}>{t("retry")}</Button>
        ) : undefined
      }
    />
  );
}
