/**
 * OperatorAccountCenter.tsx — operator self-service account center (Phase B).
 * @package @vxture/accounts
 *
 * Reads only the workforce identity and manages its contact, password and MFA.
 * Confirmed session loss clears the account shell and returns to the public home.
 */
"use client";
import {
  SecurityVerification,
  useSecurityVerificationControls,
  SecurityCompletion,
} from "./SecurityVerification";
import { validNewPassword } from "@/lib/password-policy";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Banner,
  Button,
  DialogForm,
  Field,
  FieldLabel,
  Input,
  Skeleton,
  StatusBadge,
} from "@vxture/design-system";
import { PasswordInput } from "./PasswordInput";
import { useSearchParams } from "next/navigation";
import {
  AccountHeading,
  AccountSection,
  AccountRow,
} from "./AccountPrimitives";
import { useTranslations } from "next-intl";
import {
  fetchOperatorSelf,
  startOperatorEmailChange,
  verifyOperatorEmailChange,
  startOperatorPhoneChange,
  verifyOperatorPhoneChange,
  changeOperatorPassword,
  startOperatorMfaTotp,
  confirmOperatorMfaTotp,
  OperatorUnauthenticatedError,
  type OperatorSelf,
} from "@/api/operator-self";
import { VerificationCodeInput } from "./VerificationCodeInput";
import { MfaEnrollment } from "./MfaEnrollment";
import { MfaCompletion } from "./CustomerMfaPanel";
import {
  useAccountSessionExpired,
  useAccountMenuUpdate,
  useAccountCompletion,
} from "./AccountCenterShell";

type Load =
  | { state: "loading" }
  | { state: "unauth" }
  | { state: "error"; message: string }
  | { state: "ready"; self: OperatorSelf };

export function OperatorAccountCenter() {
  const expire = useAccountSessionExpired();
  const updateMenu = useAccountMenuUpdate();
  const t = useTranslations("operatorAccount");
  const center = useTranslations("accountCenter");
  const ui = useTranslations("accountsUi");
  const section =
    useSearchParams().get("section") === "security" ? "security" : "profile";
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const inFlight = useRef(false);
  const active = useRef(false);

  useEffect(() => {
    if (load.state !== "ready") return;
    updateMenu({
      identityKey: `workforce:${load.self.username}`,
      account: load.self.username,
      displayName: load.self.username,
      phone: load.self.phone,
      email: load.self.email,
    });
  }, [load, updateMenu]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const self = await fetchOperatorSelf();
      if (active.current) setLoad({ state: "ready", self });
    } catch (e) {
      if (!active.current) return;
      if (e instanceof OperatorUnauthenticatedError) {
        setLoad({ state: "unauth" });
        expire();
      } else
        setLoad((previous) =>
          previous.state === "ready"
            ? previous
            : {
                state: "error",
                message: e instanceof Error ? e.message : "",
              },
        );
    } finally {
      inFlight.current = false;
    }
  }, [expire]);

  useEffect(() => {
    active.current = true;
    let lastReadAt = Date.now();
    void refresh();
    const reconcile = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - lastReadAt < 1500
      )
        return;
      lastReadAt = Date.now();
      void refresh();
    };
    const interval = window.setInterval(reconcile, 300_000);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      active.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [refresh]);

  if (load.state === "unauth") return null;
  return (
    <main className="flex flex-col gap-lg">
      <AccountHeading
        title={ui(section)}
        icon={section === "security" ? "shield-check" : "user"}
      />

      {load.state === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : load.state === "error" ? (
        <div className="flex flex-col items-start gap-md">
          <Banner
            tone="danger"
            title={t("loadFailed")}
            description={load.message}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setLoad({ state: "loading" });
              void refresh();
            }}
          >
            {center("retry")}
          </Button>
        </div>
      ) : (
        <ReadyView
          key={`${section}:${load.self.username}`}
          section={section}
          self={load.self}
        />
      )}
    </main>
  );
}

/** null = no flow open; otherwise the two-step contact-change flow for email|phone. */
type ContactFlow = {
  kind: "email" | "phone";
  step: "input" | "verification" | "code";
  proofToken?: string;
  value: string;
  sentTo: string;
  code: string;
};

function ReadyView({
  section,
  self,
}: {
  section: "profile" | "security";
  self: OperatorSelf;
}) {
  const t = useTranslations("operatorAccount");
  const beginCompletion = useAccountCompletion();
  const verification = useSecurityVerificationControls();
  const [flow, setFlow] = useState<ContactFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formText = useTranslations("accountsForms");

  function open(kind: "email" | "phone") {
    setError(null);
    setFlow({ kind, step: "input", value: "", sentTo: "", code: "" });
  }
  function cancel() {
    setFlow(null);
    setError(null);
  }

  async function sendContact(proofToken?: string) {
    if (!flow) return;
    const value =
      flow.kind === "email"
        ? flow.value.trim().toLowerCase()
        : flow.value.trim();
    const res =
      flow.kind === "email"
        ? await startOperatorEmailChange(value, proofToken)
        : await startOperatorPhoneChange(value, proofToken);
    setFlow({
      ...flow,
      step: "code",
      sentTo: res.sentTo,
      ...(proofToken ? { proofToken } : {}),
    });
  }
  async function onSubmitContact(event: FormEvent) {
    event.preventDefault();
    if (!flow || busy) return;
    if (flow.step === "verification") {
      verification.submit();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (flow.step === "input") {
        const value =
          flow.kind === "email"
            ? flow.value.trim().toLowerCase()
            : flow.value.trim();
        const current = flow.kind === "email" ? self.email : self.phone;
        const verified =
          flow.kind === "email" ? self.emailVerified : self.phoneVerified;
        if (value === current && !verified) await sendContact();
        else setFlow({ ...flow, step: "verification" });
      } else {
        const completion = beginCompletion();
        try {
          if (flow.kind === "email")
            await verifyOperatorEmailChange(
              flow.code.trim(),
              flow.value.trim().toLowerCase(),
              flow.proofToken,
            );
          else
            await verifyOperatorPhoneChange(
              flow.value.trim(),
              flow.code.trim(),
              flow.proofToken,
            );
          completion.complete(<SecurityCompletion realm="workforce" />);
          setFlow(null);
        } catch (reason) {
          completion.cancel();
          throw reason;
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      {section === "profile" ? (
        <AccountSection title={t("section.account")} icon="user">
          <div>
            <Row label={t("field.username")}>{self.username}</Row>
            <Row label={t("field.email")}>
              <ContactValue
                value={self.email}
                verified={self.emailVerified}
                notSet={t("notSet")}
                verifiedLabel={t("verified")}
                unverifiedLabel={t("unverified")}
                onChange={() => open("email")}
                changeLabel={t("email.change")}
                disabled={flow !== null}
              />
            </Row>
            <Row label={t("field.phone")}>
              <ContactValue
                value={self.phone}
                verified={self.phoneVerified}
                notSet={t("notSet")}
                verifiedLabel={t("verified")}
                unverifiedLabel={t("unverified")}
                onChange={() => open("phone")}
                changeLabel={t("phone.change")}
                disabled={flow !== null}
              />
            </Row>
            <Row label={t("field.role")}>{self.role}</Row>
          </div>

          {flow ? (
            <DialogForm
              open
              size="sm"
              title={
                flow.kind === "email" ? t("email.change") : t("phone.change")
              }
              description={formText("contact_change_consequence")}
              submitting={busy}
              pendingLabel={formText("processing")}
              cancelLabel={formText("cancel")}
              submitLabel={
                flow.step === "verification"
                  ? verification.label
                  : flow.step === "input"
                    ? formText("continue")
                    : t("email.verify")
              }
              submitDisabled={
                flow.step === "verification"
                  ? verification.disabled
                  : flow.step === "input"
                    ? !flow.value.trim()
                    : !/^\d{6}$/.test(flow.code)
              }
              onOpenChange={(next) => {
                if (!next && !busy) cancel();
              }}
              onSubmit={onSubmitContact}
            >
              {flow.step === "verification" ? (
                <SecurityVerification
                  controls={verification.controls}
                  realm="workforce"
                  operation={`${flow.kind}-change`}
                  target={
                    flow.kind === "email"
                      ? flow.value.trim().toLowerCase()
                      : flow.value.trim()
                  }
                  onBusyChange={setBusy}
                  onVerified={sendContact}
                />
              ) : flow.step === "input" ? (
                <Field>
                  <FieldLabel htmlFor="operatoraccountcenter-email-newlabel">
                    {flow.kind === "email"
                      ? t("email.newLabel")
                      : t("phone.newLabel")}
                  </FieldLabel>
                  <Input
                    id="operatoraccountcenter-email-newlabel"
                    required
                    disabled={busy}
                    type={flow.kind === "email" ? "email" : "tel"}
                    value={flow.value}
                    onChange={(ev) =>
                      setFlow({ ...flow, value: ev.target.value })
                    }
                    placeholder={
                      flow.kind === "email" ? "you@example.com" : "13800000000"
                    }
                    autoComplete={flow.kind === "email" ? "email" : "tel"}
                  />
                </Field>
              ) : (
                <>
                  <p className="text-body-small text-muted-foreground">
                    {t("email.sentHint", { target: flow.sentTo })}
                  </p>
                  <VerificationCodeInput
                    name="contact_code"
                    label={t("email.codeLabel")}
                    value={flow.code}
                    disabled={busy}
                    onChange={(code) => setFlow({ ...flow, code })}
                  />
                </>
              )}
              {error ? (
                <Banner tone="danger" title={error || t("loadFailed")} />
              ) : null}
            </DialogForm>
          ) : null}
        </AccountSection>
      ) : null}

      {section === "security" ? (
        <>
          <PasswordCard />

          <MfaCard enabled={self.mfaTotpEnabled} />
        </>
      ) : null}
    </div>
  );
}

/** Keep current-factor proof, enrollment and recovery acknowledgment in modal flows. */
function MfaCard({ enabled }: { enabled: boolean }) {
  const t = useTranslations("operatorAccount");
  const formText = useTranslations("accountsForms");
  const beginCompletion = useAccountCompletion();
  const [phase, setPhase] = useState<"idle" | "enroll">("idle");
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function reset() {
    setOpen(false);
    setPhase("idle");
    setCurrentPassword("");
    setCurrentCode("");
    setEnrollmentToken("");
    setOtpauthUri("");
    setSecret("");
    setCode("");
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (phase === "idle") {
        const result = await startOperatorMfaTotp(currentPassword, currentCode);
        setOtpauthUri(result.otpauthUri);
        setSecret(result.secret);
        setEnrollmentToken(result.enrollmentToken);
        setCurrentPassword("");
        setCurrentCode("");
        setPhase("enroll");
      } else {
        const completion = beginCompletion();
        try {
          const result = await confirmOperatorMfaTotp(
            code.trim(),
            enrollmentToken,
          );
          completion.complete(
            <MfaCompletion realm="workforce" codes={result.recoveryCodes} />,
          );
          reset();
        } catch (reason) {
          completion.cancel();
          throw reason;
        }
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : formText("unable_to_complete_this_action"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountSection
      title={t("mfa.title")}
      icon="shield-check"
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
        >
          {enabled ? t("mfa.reenroll") : t("mfa.setup")}
        </Button>
      }
    >
      <StatusBadge tone={enabled ? "success" : "warning"}>
        {enabled ? t("mfa.enabled") : t("mfa.disabled")}
      </StatusBadge>
      <DialogForm
        open={open}
        size="sm"
        title={enabled ? t("mfa.reenroll") : t("mfa.setup")}
        description={formText("operator_mfa_consequence")}
        danger={enabled && phase === "enroll"}
        submitting={busy}
        pendingLabel={formText("processing")}
        cancelLabel={formText("cancel")}
        submitLabel={phase === "idle" ? formText("continue") : t("mfa.confirm")}
        submitDisabled={
          phase === "idle"
            ? !currentPassword || (enabled && !/^\d{6}$/.test(currentCode))
            : !/^\d{6}$/.test(code)
        }
        onOpenChange={(next) => {
          if (!next && !busy) reset();
        }}
        onSubmit={submit}
      >
        {phase === "idle" ? (
          <>
            <p className="text-body-small text-muted-foreground">
              {t("mfa.reauthHint")}
            </p>
            <Field>
              <FieldLabel htmlFor="mfa-current-password">
                {t("mfa.currentPassword")}
              </FieldLabel>
              <PasswordInput
                id="mfa-current-password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={busy}
              />
            </Field>
            {enabled ? (
              <VerificationCodeInput
                name="mfa-current-code"
                label={t("mfa.currentCode")}
                value={currentCode}
                onChange={setCurrentCode}
                disabled={busy}
              />
            ) : null}
          </>
        ) : (
          <MfaEnrollment
            secret={secret}
            otpauthUri={otpauthUri}
            code={code}
            onChange={setCode}
            disabled={busy}
          />
        )}
        {error ? <Banner tone="danger" title={error} /> : null}
      </DialogForm>
    </AccountSection>
  );
}

function ContactValue({
  value,
  verified,
  notSet,
  verifiedLabel,
  unverifiedLabel,
  onChange,
  changeLabel,
  disabled,
}: {
  value: string | null;
  verified: boolean;
  notSet: string;
  verifiedLabel: string;
  unverifiedLabel: string;
  onChange: () => void;
  changeLabel: string;
  disabled: boolean;
}) {
  return (
    <span className="accounts-contact-value">
      <span className="inline-flex items-center gap-xs">
        {value ?? notSet}
        {value ? (
          <StatusBadge tone={verified ? "success" : "warning"}>
            {verified ? verifiedLabel : unverifiedLabel}
          </StatusBadge>
        ) : null}
      </span>
      <Button variant="link" size="sm" onClick={onChange} disabled={disabled}>
        {changeLabel}
      </Button>
    </span>
  );
}

function PasswordCard() {
  const verification = useSecurityVerificationControls();
  const t = useTranslations("accountsForms");
  const operator = useTranslations("operatorAccount");
  const beginCompletion = useAccountCompletion();
  const [open, setOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [policyError, setPolicyError] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function reset() {
    setOpen(false);
    setVerifying(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setPolicyError(false);
    setMismatch(false);
    setError("");
  }
  return (
    <AccountSection
      title={operator("password.title")}
      icon="key"
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
        >
          {operator("password.change")}
        </Button>
      }
    >
      <DialogForm
        footerNote={t("password_relogin_hint")}
        open={open}
        size="sm"
        title={operator("password.change")}
        submitting={busy}
        pendingLabel={t("processing")}
        cancelLabel={t("cancel")}
        submitLabel={verifying ? verification.label : t("confirm_change")}
        submitDisabled={
          verifying ? verification.disabled : !current || !next || !confirm
        }
        onOpenChange={(value) => {
          if (!value && !busy) reset();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (verifying) {
            verification.submit();
            return;
          }
          const valid = validNewPassword(next, "workforce");
          setPolicyError(!valid);
          setMismatch(next !== confirm);
          if (valid && next === confirm) setVerifying(true);
        }}
      >
        {verifying ? (
          <SecurityVerification
            controls={verification.controls}
            realm="workforce"
            operation="password"
            target=""
            onBusyChange={setBusy}
            onVerified={async (proofToken) => {
              const completion = beginCompletion();
              try {
                await changeOperatorPassword(current, next, proofToken);
                reset();
                completion.complete(<SecurityCompletion realm="workforce" />);
              } catch (reason) {
                completion.cancel();
                setVerifying(false);
                setError(
                  reason instanceof Error
                    ? reason.message
                    : t("verification_failed"),
                );
                throw reason;
              }
            }}
          />
        ) : (
          <div className="accounts-settings-form">
            <div className="accounts-password-group">
              <label
                htmlFor="operator-current-password"
                className="accounts-password-group-label"
              >
                {t("current_password")}
                <span className="accounts-required" aria-hidden="true">
                  *
                </span>
              </label>
              <PasswordInput
                id="operator-current-password"
                aria-label={t("current_password")}
                placeholder={t("current_password")}
                autoComplete="current-password"
                maxLength={128}
                required
                disabled={busy}
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </div>
            <div className="accounts-password-group">
              <label
                htmlFor="operator-new-password"
                className="accounts-password-group-label"
              >
                {t("new_password")}
                <span className="accounts-required" aria-hidden="true">
                  *
                </span>
              </label>
              <div className="accounts-password-field">
                <PasswordInput
                  id="operator-new-password"
                  aria-label={t("new_password")}
                  placeholder={t("new_password")}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={busy}
                  value={next}
                  aria-invalid={policyError}
                  aria-describedby="operator-password-policy"
                  onChange={(event) => {
                    setNext(event.target.value);
                    setPolicyError(false);
                  }}
                />
              </div>
              <div className="accounts-password-field">
                <PasswordInput
                  aria-label={t("confirm_password")}
                  placeholder={t("confirm_password")}
                  autoComplete="new-password"
                  maxLength={128}
                  required
                  disabled={busy}
                  value={confirm}
                  aria-invalid={mismatch}
                  aria-describedby={
                    mismatch ? "operator-password-mismatch" : undefined
                  }
                  onChange={(event) => {
                    setConfirm(event.target.value);
                    setMismatch(false);
                  }}
                />
                {mismatch ? (
                  <p
                    id="operator-password-mismatch"
                    role="alert"
                    className="text-body-small text-danger"
                  >
                    {t("password_mismatch")}
                  </p>
                ) : null}
              </div>
              <p
                id="operator-password-policy"
                className={
                  policyError
                    ? "text-body-small text-danger"
                    : "text-body-small text-muted-foreground"
                }
              >
                {t("password_policy_workforce")}
              </p>
            </div>
          </div>
        )}
        {error ? <Banner tone="danger" title={error} /> : null}
      </DialogForm>
    </AccountSection>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <AccountRow label={label}>{children}</AccountRow>;
}
