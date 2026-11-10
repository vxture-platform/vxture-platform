/**
 * Existing identity confirmation without redundant contact-code challenges.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-10
 */
"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useTranslations } from "next-intl";
import { Banner, Button, Input, NativeSelect } from "@vxture/design-system";
import {
  securityVerificationOptions,
  startSecurityVerification,
  verifySecurityTicket,
  verifySecurityPasskey,
  type SecurityScope,
} from "@/api/security-verification";
import { AuthResultPanel } from "./auth/AuthLogin";
import { PasswordInput } from "./PasswordInput";
import { VerificationCodeInput } from "./VerificationCodeInput";

// ============================================================================
// Server-selected methods and ephemeral interaction state
// ============================================================================
type VerificationActionState = { disabled: boolean; label: string };
type VerificationControls = {
  submitRef: RefObject<(() => Promise<void>) | null>;
  onStateChange: (state: VerificationActionState) => void;
};

/** Reuse the enclosing dialog's primary action throughout identity confirmation. */
export function useSecurityVerificationControls() {
  const submitRef = useRef<(() => Promise<void>) | null>(null);
  const [state, onStateChange] = useState<VerificationActionState>({
    disabled: true,
    label: "",
  });
  return {
    ...state,
    submit: () => {
      void submitRef.current?.();
    },
    controls: { submitRef, onStateChange },
  };
}

export function SecurityVerification({
  realm,
  operation,
  target,
  onVerified,
  onBusyChange,
  controls,
}: SecurityScope & {
  onVerified: (proofToken: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  controls: VerificationControls;
}) {
  const { submitRef, onStateChange } = controls;
  const t = useTranslations("accountsForms");
  const [methods, setMethods] = useState<string[] | null>(null);
  const [method, setMethod] = useState("");
  const [ticket, setTicket] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    setMethods(null);
    setTicket("");
    setPassword("");
    setCode("");
    securityVerificationOptions({ realm, operation, target })
      .then((result) => {
        if (active) {
          setMethods(result.methods);
          setMethod(result.methods[0] ?? "");
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : t("verification_failed"),
          );
      });
    return () => {
      active = false;
    };
  }, [realm, operation, target, revision, t]);

  const contact = method === "phone" || method === "email";
  const names: Record<string, string> = {
    password: t("current_password"),
    phone: t("sms_code"),
    email: t("email_code"),
    totp: t("authenticator_code"),
    recovery: t("recovery_code"),
    webauthn: t("verify_passkey"),
  };
  const disabled =
    busy ||
    !methods?.length ||
    !method ||
    (method === "password"
      ? !password
      : method === "totp" || (contact && ticket)
        ? code.length !== 6
        : method === "recovery"
          ? !code.trim()
          : false);
  const label = busy
    ? t("verifying")
    : contact && !ticket
      ? t("send_code")
      : t("confirm_identity");
  useLayoutEffect(() => {
    submitRef.current = verify;
    return () => {
      submitRef.current = null;
    };
  });
  useEffect(() => {
    onStateChange({ disabled, label });
  }, [disabled, label, onStateChange]);
  async function verify() {
    if (disabled) return;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      const scope = { realm, operation, target };
      if (method === "webauthn") {
        const result = await verifySecurityPasskey(scope);
        await onVerified(result.proofToken);
        return;
      }
      const id =
        ticket ||
        (await startSecurityVerification(scope, method)).verificationId;
      setTicket(id);
      if (contact && !ticket) return;
      const result = await verifySecurityTicket(
        scope,
        id,
        method === "password" ? { password } : { code },
      );
      setPassword("");
      setCode("");
      await onVerified(result.proofToken);
    } catch (reason) {
      setTicket("");
      setCode("");
      setError(
        reason instanceof Error ? reason.message : t("verification_failed"),
      );
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <div
      className="accounts-settings-form accounts-security-verification"
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) void verify();
        }
      }}
    >
      <p className="text-body-small text-muted-foreground">
        {t("confirm_identity_hint")}
      </p>
      {methods === null ? (
        error ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("start_again")}
          </Button>
        ) : (
          <p role="status">{t("loading_verification")}</p>
        )
      ) : (
        <>
          {methods.length > 1 ? (
            <NativeSelect
              aria-label={t("verification_method")}
              value={method}
              disabled={busy}
              onChange={(event) => {
                setMethod(event.target.value);
                setTicket("");
                setCode("");
                setPassword("");
                setError("");
              }}
            >
              {methods.map((item) => (
                <option key={item} value={item}>
                  {names[item]}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {method === "password" ? (
            <PasswordInput
              aria-label={t("current_password")}
              placeholder={t("current_password")}
              autoComplete="current-password"
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          ) : method === "recovery" ? (
            <Input
              aria-label={t("recovery_code")}
              placeholder={t("recovery_code")}
              autoComplete="off"
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.target.value)}
            />
          ) : method === "totp" || (contact && ticket) ? (
            <VerificationCodeInput
              name="security-verification-code"
              label={names[method] ?? t("verification_code")}
              value={code}
              onChange={setCode}
              disabled={busy}
            />
          ) : null}
          {!methods.length ? <p>{t("verified_contact_required")}</p> : null}
        </>
      )}
      {error ? <Banner tone="danger" title={error} /> : null}
    </div>
  );
}

/** Show a realm-correct receipt while revoked profile data remains unmounted. */
export function SecurityCompletion({
  realm,
}: {
  realm: "customer" | "workforce";
}) {
  const t = useTranslations("accountsForms");
  return (
    <div className="accounts-auth">
      <AuthResultPanel
        tone="success"
        title={t("done_please_sign_in_again")}
        action={
          <Button
            onClick={() =>
              window.location.replace(
                realm === "workforce" ? "/workforce/login" : "/login",
              )
            }
          >
            {t("sign_in_again")}
          </Button>
        }
      />
    </div>
  );
}
