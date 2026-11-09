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
import { useEffect, useId, useState } from "react";
import {
  Banner,
  Button,
  DialogForm,
  Checkbox,
  Input,
  StatusBadge,
} from "@vxture/design-system";
import { useAccountCompletion } from "./AccountCenterShell";
import { accountsRequest } from "@/api/customer-self";
import { AccountSection } from "./AccountPrimitives";
import { VerificationCodeInput } from "./VerificationCodeInput";
import { MfaEnrollment } from "./MfaEnrollment";
import { AuthLoginTemplate } from "./auth/AuthLogin";
import { AccountsAuthFooter, AccountsAuthHeader } from "./AuthChrome";

// ============================================================================
// Optional customer enrollment
// ============================================================================
/** Show a one-time result without keeping revoked account content mounted. */
function MfaCompletion({ codes }: { codes?: readonly string[] }) {
  const formText = useTranslations("accountsForms");
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState("");
  const checkboxId = useId();
  function leave() {
    if (codes && !saved) {
      setFeedback(formText("recovery_ack_required"));
      return;
    }
    window.location.replace("/login");
  }
  return (
    <DialogForm
      open
      size="sm"
      title={codes ? formText("save_recovery_codes") : formText("disable_mfa")}
      description={
        codes
          ? formText("done_please_sign_in_again")
          : formText("mfa_disabled_sign_in")
      }
      submitLabel={formText("back_to_sign_in")}
      cancelLabel={formText("cancel")}
      submitDisabled={Boolean(codes && !saved)}
      onOpenChange={(next) => {
        if (!next) leave();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        leave();
      }}
    >
      {codes ? (
        <div className="accounts-recovery">
          <p className="text-body-sm text-muted-foreground">
            {formText(
              "save_these_recovery_codes_now_each_code_can_only_be_used_once",
            )}
          </p>
          <ul className="accounts-recovery-codes">
            {codes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(codes.join("\n"));
                setFeedback(formText("copied"));
              } catch {
                setFeedback(
                  formText("unable_to_copy_save_the_recovery_codes_manually"),
                );
              }
            }}
          >
            {formText("copy_recovery_codes")}
          </Button>
          <div className="flex items-center gap-sm">
            <Checkbox
              id={checkboxId}
              checked={saved}
              onCheckedChange={(value) => setSaved(value === true)}
            />
            <label htmlFor={checkboxId} className="text-body-sm">
              {formText("i_have_saved_my_recovery_codes")}
            </label>
          </div>
        </div>
      ) : null}
      {feedback ? (
        <p role="status" className="text-body-sm">
          {feedback}
        </p>
      ) : null}
    </DialogForm>
  );
}

/** Require phone ownership for enrollment and factor ownership for removal. */
export function CustomerMfaPanel() {
  const formText = useTranslations("accountsForms");
  const beginCompletion = useAccountCompletion();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<"start" | "phone" | "enroll">("start");
  const [open, setOpen] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [material, setMaterial] = useState({
    secret: "",
    otpauthUri: "",
    enrollmentToken: "",
  });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setStatusError("");
    accountsRequest<{ enabled: boolean }>("/oidc/customer/self/mfa", {
      signal: controller.signal,
    })
      .then((status) => {
        if (!controller.signal.aborted) setEnabled(status.enabled);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setStatusError(
          e instanceof Error ? e.message : formText("unable_to_load"),
        );
      });
    return () => controller.abort();
  }, [revision, formText]);

  function close() {
    if (busy) return;
    setOpen(false);
    setCode("");
    setChallenge("");
    setMaterial({ secret: "", otpauthUri: "", enrollmentToken: "" });
    setPhase("start");
    setError("");
    setRecovery(false);
  }
  async function run() {
    if (busy || enabled === null) return;
    setBusy(true);
    setError("");
    // The receipt owns the result before a background read can observe self-revocation.
    const completion = enabled || phase === "enroll" ? beginCompletion() : null;
    try {
      if (enabled) {
        await accountsRequest("/oidc/customer/self/mfa/disable", {
          method: "POST",
          body: JSON.stringify({
            method: recovery ? "recovery" : "totp",
            code: code.trim(),
          }),
        });
        completion?.complete(<MfaCompletion />);
      } else if (phase === "start") {
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
        const result = await accountsRequest<typeof material>(
          "/oidc/customer/self/mfa/enroll",
          { method: "POST", body: JSON.stringify({ challengeId: challenge }) },
        );
        setMaterial(result);
        setCode("");
        setPhase("enroll");
      } else {
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
        setCode("");
        setMaterial({ secret: "", otpauthUri: "", enrollmentToken: "" });
        completion?.complete(<MfaCompletion codes={result.recoveryCodes} />);
      }
    } catch (e) {
      completion?.cancel();
      setError(
        e instanceof Error
          ? e.message
          : formText("unable_to_complete_this_action"),
      );
      // An anchor proof is consumed on enrollment: a retry must start a new ceremony.
      if (!enabled && phase === "phone") {
        setPhase("start");
        setChallenge("");
        setCode("");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <AccountSection
        title={formText("multi_factor_authentication")}
        icon="shield-check"
        action={
          enabled !== null ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
              {formText(enabled ? "disable_mfa" : "enable")}
            </Button>
          ) : undefined
        }
      >
        <div className="accounts-mfa-summary">
          <StatusBadge tone={enabled ? "success" : "neutral"}>
            {enabled === null
              ? formText("loading")
              : enabled
                ? formText("enabled_2")
                : formText("not_enabled")}
          </StatusBadge>
          <p>{formText(enabled ? "mfa_enabled_help" : "mfa_help")}</p>
        </div>
        {statusError ? (
          <>
            <Banner tone="danger" title={statusError} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRevision((value) => value + 1)}
            >
              {formText("start_again")}
            </Button>
          </>
        ) : null}
      </AccountSection>
      <DialogForm
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        size="sm"
        title={formText(enabled ? "disable_mfa" : "enable_mfa")}
        description={
          enabled
            ? formText("mfa_disable_warning")
            : phase === "start"
              ? formText("mfa_phone_step")
              : undefined
        }
        danger={enabled === true}
        submitting={busy}
        pendingLabel={formText("processing")}
        cancelLabel={formText("cancel")}
        submitLabel={formText(
          enabled
            ? "mfa_disable_confirm"
            : phase === "start"
              ? "send_code"
              : phase === "phone"
                ? "continue"
                : "confirm_authenticator",
        )}
        submitDisabled={
          enabled === null ||
          ((enabled || phase !== "start") &&
            (enabled && recovery ? !code.trim() : code.length !== 6))
        }
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        {enabled ? (
          <>
            {recovery ? (
              <Input
                aria-label={formText("recovery_code")}
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={busy}
              />
            ) : (
              <VerificationCodeInput
                name="disable_mfa_code"
                label={formText("authenticator_code")}
                value={code}
                onChange={setCode}
                disabled={busy}
              />
            )}
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
              {formText(recovery ? "use_authenticator" : "use_a_recovery_code")}
            </Button>
          </>
        ) : phase === "phone" ? (
          <VerificationCodeInput
            name="enable_mfa_code"
            label={formText("sms_verification_code")}
            value={code}
            onChange={setCode}
            disabled={busy}
          />
        ) : phase === "enroll" ? (
          <MfaEnrollment
            secret={material.secret}
            otpauthUri={material.otpauthUri}
            code={code}
            onChange={setCode}
            disabled={busy}
          />
        ) : (
          <p className="text-body-sm text-muted-foreground">
            {formText("mfa_help")}
          </p>
        )}
        {error ? <Banner tone="danger" title={error} /> : null}
      </DialogForm>
    </>
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
