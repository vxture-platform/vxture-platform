/**
 * CustomerMfaPanel.tsx - customer MFA setup and login continuation.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Banner, Button, Input, StatusBadge } from "@vxture/design-system";
import { accountsRequest } from "@/api/customer-self";
import { AccountSection } from "./AccountPrimitives";
import { VerificationCodeInput } from "./VerificationCodeInput";
import { MfaEnrollment } from "./MfaEnrollment";
import { MfaRecoveryCodes } from "./MfaRecoveryCodes";
import { AuthLoginTemplate } from "./auth/AuthLogin";
import { AccountsAuthFooter, AccountsAuthHeader } from "./AuthChrome";

// ============================================================================
// Optional customer enrollment
// ============================================================================
/** Require current phone ownership before staging an authenticator. */
export function CustomerMfaPanel() {
  const formText = useTranslations("accountsForms");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState("idle");
  const [challenge, setChallenge] = useState("");
  const [material, setMaterial] = useState({
    secret: "",
    otpauthUri: "",
    enrollmentToken: "",
  });
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    accountsRequest<{ enabled: boolean }>("/oidc/customer/self/mfa", {
      signal: controller.signal,
    })
      .then((s) => setEnabled(s.enabled))
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : formText("unable_to_load"));
      });
    return () => controller.abort();
  }, [revision, formText]);
  async function run() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (phase === "idle") {
        const result = await accountsRequest<{ challengeId: string }>(
          "/oidc/customer/self/mfa/challenges",
          { method: "POST", body: "{}" },
        );
        setChallenge(result.challengeId);
        setPhase("phone");
      } else if (phase === "phone") {
        await accountsRequest(
          `/oidc/customer/self/security/challenges/${challenge}/verify`,
          { method: "POST", body: JSON.stringify({ code }) },
        );
        setCode("");
        setPhase("verified");
        const result = await accountsRequest<typeof material>(
          "/oidc/customer/self/mfa/enroll",
          { method: "POST", body: JSON.stringify({ challengeId: challenge }) },
        );
        setMaterial(result);
        setPhase("enroll");
      } else if (phase === "enroll") {
        const result = await accountsRequest<{ recoveryCodes: string[] }>(
          "/oidc/customer/self/mfa/confirm",
          {
            method: "POST",
            body: JSON.stringify({
              enrollmentToken: material.enrollmentToken,
              code,
            }),
          },
        );
        setCodes(result.recoveryCodes);
        setCode("");
        setMaterial({ secret: "", otpauthUri: "", enrollmentToken: "" });
        setPhase("codes");
        setEnabled(true);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : formText("unable_to_complete_this_action"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountSection
      title={
        phase === "enroll"
          ? formText("set_up_authenticator")
          : phase === "codes"
            ? formText("save_recovery_codes")
            : formText("multi_factor_authentication")
      }
      icon="shield-check"
      action={
        phase === "idle" && enabled === false ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? formText("processing") : formText("enable")}
          </Button>
        ) : undefined
      }
    >
      <div className="accounts-settings-form">
        {phase === "codes" ? (
          <MfaRecoveryCodes
            codes={codes}
            onContinue={() => {
              setCodes([]);
              window.location.assign("/login");
            }}
          />
        ) : (
          <>
            {phase === "idle" ? (
              <StatusBadge tone={enabled ? "success" : "neutral"}>
                {enabled === null
                  ? formText("loading")
                  : enabled
                    ? formText("enabled_2")
                    : formText("not_enabled")}
              </StatusBadge>
            ) : null}
            {phase === "phone" ? (
              <>
                <p className="text-body-sm text-muted-foreground">
                  {formText("verify_your_current_phone")}
                </p>
                <VerificationCodeInput
                  name="enable_mfa_code"
                  label={formText("sms_verification_code")}
                  value={code}
                  onChange={setCode}
                  disabled={busy}
                />
              </>
            ) : null}
            {phase === "enroll" ? (
              <MfaEnrollment
                secret={material.secret}
                otpauthUri={material.otpauthUri}
                code={code}
                onChange={setCode}
                disabled={busy}
              />
            ) : null}
            {phase === "phone" || phase === "enroll" ? (
              <Button
                disabled={
                  busy ||
                  (["phone", "enroll"].includes(phase) && code.length !== 6)
                }
                onClick={() => void run()}
              >
                {busy
                  ? formText("processing")
                  : phase === "enroll"
                    ? formText("confirm_authenticator")
                    : formText("continue")}
              </Button>
            ) : null}
          </>
        )}
        {error ? (
          <>
            <Banner tone="danger" title={error} />
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPhase("idle");
                setCode("");
                setError("");
                setRevision((v) => v + 1);
              }}
            >
              {formText("start_again")}
            </Button>
          </>
        ) : null}
      </div>
    </AccountSection>
  );
}

// ============================================================================
// Customer login second factor
// ============================================================================
/** No session or RP code exists until this continuation succeeds. */
export function CustomerMfaChallenge({ token }: { token: string }) {
  const formText = useTranslations("accountsForms");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <AuthLoginTemplate
      title={formText("multi_factor_authentication")}
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
    >
      <form
        className="accounts-settings-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const result = await accountsRequest<{ redirectTo: string }>(
              "/oidc/customer/mfa/verify",
              {
                method: "POST",
                body: JSON.stringify({
                  mfa_token: token,
                  method: recovery ? "recovery" : "totp",
                  code,
                }),
              },
            );
            window.location.assign(result.redirectTo);
          } catch (e) {
            setError(
              e instanceof Error ? e.message : formText("verification_failed"),
            );
            setBusy(false);
          }
        }}
      >
        {recovery ? (
          <Input
            aria-label={formText("recovery_code")}
            placeholder={formText("recovery_code")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
          />
        ) : (
          <VerificationCodeInput
            name="customer_mfa"
            label={formText("authenticator_code")}
            value={code}
            onChange={setCode}
            disabled={busy}
            autoFocus
          />
        )}
        {error ? <Banner tone="danger" title={error} /> : null}
        <Button
          type="submit"
          disabled={busy || (recovery ? !code.trim() : code.length !== 6)}
        >
          {busy ? formText("verifying") : formText("verify_and_sign_in")}
        </Button>
        <Button
          type="button"
          variant="link"
          disabled={busy}
          onClick={() => {
            setRecovery(!recovery);
            setCode("");
            setError("");
          }}
        >
          {recovery
            ? formText("use_authenticator")
            : formText("use_a_recovery_code")}
        </Button>
      </form>
    </AuthLoginTemplate>
  );
}

/** Resume a social login using the HttpOnly pending cookie rather than a URL token. */
export function CustomerMfaPending() {
  const formText = useTranslations("accountsForms");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    accountsRequest<{ mfaToken: string }>("/oidc/customer/mfa/pending")
      .then((s) => {
        if (active) setToken(s.mfaToken);
      })
      .catch(() => {
        if (active)
          setError(formText("verification_expired_please_sign_in_again"));
      });
    return () => {
      active = false;
    };
  }, [formText]);
  return token ? (
    <CustomerMfaChallenge token={token} />
  ) : (
    <AuthLoginTemplate
      title={formText("multi_factor_authentication")}
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
    >
      {error ? (
        <Banner tone="danger" title={error} />
      ) : (
        <p role="status">{formText("loading_verification")}</p>
      )}
    </AuthLoginTemplate>
  );
}
