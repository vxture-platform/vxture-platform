/**
 * OperatorMfaFlow.tsx - operator second-factor continuation (Step2 + enroll).
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 *
 * Rendered after an operator's first factor succeeds and the IdP returns
 * `mfa_required` (identity-platform-operator.md §3.2). Three sub-steps, reusing
 * the design-system auth primitives (no design-system changes):
 *   - verify   — enter a TOTP code (or a recovery code) → /mfa/verify.
 *   - enroll   — enroll-on-login: scan the QR + confirm the first code →
 *                /mfa/enroll/totp(/confirm); on success surfaces recovery codes.
 *   - recovery — show the one-time recovery codes, then continue to the app.
 * On completion the browser navigates to the RP redirect (authorization code).
 */
"use client";
import { useTranslations } from "next-intl";

import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button } from "@vxture/design-system";
import {
  AuthField,
  AuthFlowForm,
  AuthLoginTemplate,
  AuthPrimaryButton,
} from "./auth/AuthLogin";
import {
  ACCOUNTS_AUTH_VISUAL,
  AccountsAuthFooter,
  AccountsAuthHeader,
} from "./AuthChrome";
import {
  beginOperatorTotpEnroll,
  confirmOperatorTotpEnroll,
  verifyOperatorMfa,
} from "@/api/oidc";
import {
  authenticateOperatorPasskey,
  enrollOperatorPasskeyOnLogin,
} from "@/api/operator-webauthn";
import { VerificationCodeInput } from "./VerificationCodeInput";
import { MfaEnrollment } from "./MfaEnrollment";
import { MfaRecoveryCodes } from "./MfaRecoveryCodes";

interface OperatorMfaFlowProps {
  readonly mfaToken: string;
  readonly methods: string[];
  readonly enrollRequired: boolean;
  readonly enrollFactor: "totp" | "webauthn" | null;
}

type Phase = "verify" | "enroll" | "recovery";

export function OperatorMfaFlow({
  mfaToken,
  methods,
  enrollRequired,
  enrollFactor,
}: OperatorMfaFlowProps) {
  const formText = useTranslations("accountsForms");

  const enrollWebauthn = enrollRequired && enrollFactor === "webauthn";
  const [phase, setPhase] = useState<Phase>(
    enrollRequired ? "enroll" : "verify",
  );
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Enroll material (fetched on entering the enroll phase).
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");

  // Recovery codes surfaced once after enrollment.
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [redirectTo, setRedirectTo] = useState("");

  // On entering the TOTP enroll phase, stage a secret + fetch the QR material.
  // The webauthn enroll branch is button-driven (no pre-fetch).
  useEffect(() => {
    if (phase !== "enroll" || enrollWebauthn || otpauthUri) return;
    let active = true;
    beginOperatorTotpEnroll(mfaToken)
      .then((m) => {
        if (!active) return;
        setSecret(m.secret);
        setOtpauthUri(m.otpauthUri);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : formText("unable_to_start_enrollment"),
          );
      });
    return () => {
      active = false;
    };
  }, [phase, otpauthUri, mfaToken, enrollWebauthn, formText]);

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    const method = useRecovery ? "recovery" : "totp";
    if (useRecovery ? !code.trim() : !/^\d{6}$/.test(code)) {
      setError(
        useRecovery
          ? formText("enter_a_recovery_code")
          : formText("enter_the_6_digit_code"),
      );
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { redirectTo: to } = await verifyOperatorMfa(
        mfaToken,
        method,
        code.trim(),
      );
      window.location.assign(to);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : formText("verification_failed_please_try_again"),
      );
      setLoading(false);
    }
  };

  const handleConfirmEnroll = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError(formText("enter_the_6_digit_authenticator_code"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await confirmOperatorTotpEnroll(mfaToken, code.trim());
      setRecoveryCodes(result.recoveryCodes);
      setRedirectTo(result.redirectTo);
      setCode("");
      setSecret("");
      setOtpauthUri("");
      setPhase("recovery");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : formText("enrollment_failed_please_try_again"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePasskey = async () => {
    setLoading(true);
    setError("");
    try {
      const { redirectTo } = await authenticateOperatorPasskey(mfaToken);
      window.location.assign(redirectTo);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : formText("passkey_verification_failed_please_try_again"),
      );
      setLoading(false);
    }
  };

  const handleEnrollPasskey = async () => {
    setLoading(true);
    setError("");
    try {
      const { redirectTo } = await enrollOperatorPasskeyOnLogin(mfaToken);
      window.location.assign(redirectTo);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : formText("passkey_enrollment_failed_please_try_again"),
      );
      setLoading(false);
    }
  };

  // ── verify ────────────────────────────────────────────────────────────────
  if (phase === "verify") {
    return (
      <Shell title={formText("multi_factor_authentication")}>
        <AuthFlowForm
          onSubmit={handleVerify}
          input={
            <>
              {useRecovery ? (
                <AuthField
                  label={formText("recovery_code")}
                  name="recovery_code"
                  type="text"
                  autoFocus
                  placeholder={formText("enter_a_recovery_code")}
                  value={code}
                  error={error}
                  disabled={loading}
                  onChange={setCode}
                />
              ) : (
                <VerificationCodeInput
                  label={formText("authenticator_code")}
                  name="mfa_code"
                  autoFocus
                  value={code}
                  error={error}
                  disabled={loading}
                  onChange={setCode}
                />
              )}
              <div className="flex flex-wrap items-center gap-md">
                <Button
                  variant="link"
                  size="xs"
                  disabled={loading}
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setCode("");
                    setError("");
                  }}
                >
                  {useRecovery
                    ? formText("use_authenticator_code")
                    : formText("use_a_recovery_code")}
                </Button>
                {methods.includes("webauthn") ? (
                  <Button
                    variant="link"
                    size="xs"
                    disabled={loading}
                    onClick={() => void handlePasskey()}
                  >
                    {formText("use_a_passkey")}
                  </Button>
                ) : null}
              </div>
            </>
          }
          primary={
            <AuthPrimaryButton
              loading={loading}
              label={formText("verify_and_sign_in")}
              disabled={useRecovery ? !code.trim() : !/^\d{6}$/.test(code)}
              loadingLabel={formText("verifying")}
            />
          }
        />
      </Shell>
    );
  }

  // ── enroll: WebAuthn (high-privilege bootstrap) ─────────────────────────--
  if (phase === "enroll" && enrollWebauthn) {
    return (
      <Shell
        title={formText("set_up_a_passkey")}
        description={formText("verify_with_your_passkey")}
      >
        <StepHint>
          {formText(
            "set_up_windows_hello_touch_id_or_a_security_key_to_sign_in",
          )}
        </StepHint>
        {error ? <Banner tone="danger" title={error} /> : null}
        <Button
          size="xl"
          className="w-full"
          disabled={loading}
          onClick={() => void handleEnrollPasskey()}
        >
          {loading
            ? formText("enrolling")
            : formText("set_up_passkey_and_sign_in")}
        </Button>
      </Shell>
    );
  }

  // TOTP enrollment and recovery use the same presentation in both realms.
  if (phase === "enroll") {
    return (
      <Shell title={formText("set_up_work_authenticator")}>
        <AuthFlowForm
          onSubmit={handleConfirmEnroll}
          input={
            <MfaEnrollment
              secret={secret}
              otpauthUri={otpauthUri}
              code={code}
              onChange={setCode}
              disabled={loading}
              error={error}
            />
          }
          primary={
            <AuthPrimaryButton
              loading={loading}
              label={formText("confirm_authenticator")}
              loadingLabel={formText("connecting")}
              disabled={!otpauthUri || !/^\d{6}$/.test(code)}
            />
          }
        />
      </Shell>
    );
  }
  return (
    <Shell title={formText("save_recovery_codes")}>
      <MfaRecoveryCodes
        codes={recoveryCodes}
        continueLabel={formText("continue_sign_in")}
        onContinue={() => window.location.assign(redirectTo)}
      />
    </Shell>
  );
}

/** Shared chrome for the MFA steps (same template as the login form). */
function Shell({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly children: React.ReactNode;
}) {
  return (
    <AuthLoginTemplate
      className="accounts-workforce-page"
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      title={title}
      description={description}
      visual={ACCOUNTS_AUTH_VISUAL}
      useLoginLayout
    >
      <div className="flex flex-col gap-md">{children}</div>
    </AuthLoginTemplate>
  );
}

/** Muted helper text for the hardware authenticator ceremony. */
function StepHint({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <p className={`text-body-sm text-muted-foreground ${className ?? ""}`}>
      {children}
    </p>
  );
}
