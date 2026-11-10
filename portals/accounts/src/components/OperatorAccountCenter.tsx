/**
 * OperatorAccountCenter.tsx — operator self-service account center (Phase B).
 * @package @vxture/accounts
 *
 * Reads only the workforce identity and manages its contact, password and MFA.
 * Confirmed session loss clears the account shell and returns to the public home.
 */
"use client";
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
  useToast,
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
  | { state: "passwordChanged" }
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
      if (active.current)
        setLoad((previous) =>
          previous.state === "passwordChanged"
            ? previous
            : { state: "ready", self },
        );
    } catch (e) {
      if (!active.current) return;
      if (e instanceof OperatorUnauthenticatedError) {
        setLoad({ state: "unauth" });
        expire();
      } else
        setLoad((previous) =>
          previous.state === "ready" || previous.state === "passwordChanged"
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
      ) : load.state === "passwordChanged" ? (
        <Banner
          tone="success"
          title={t("password.updated")}
          description={t("password.signedOutHint")}
        />
      ) : (
        <ReadyView
          key={`${section}:${load.self.username}`}
          section={section}
          self={load.self}
          onChanged={refresh}
          onPasswordChanged={() => {
            setLoad({ state: "passwordChanged" });
            expire();
          }}
        />
      )}
    </main>
  );
}

/** null = no flow open; otherwise the two-step contact-change flow for email|phone. */
type ContactFlow = {
  kind: "email" | "phone";
  step: "input" | "code";
  value: string;
  sentTo: string;
  code: string;
};

function ReadyView({
  section,
  self,
  onChanged,
  onPasswordChanged,
}: {
  section: "profile" | "security";
  self: OperatorSelf;
  onChanged: () => void;
  onPasswordChanged: () => void;
}) {
  const t = useTranslations("operatorAccount");
  const [flow, setFlow] = useState<ContactFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const formText = useTranslations("accountsForms");

  function open(kind: "email" | "phone") {
    setError(null);
    setFlow({ kind, step: "input", value: "", sentTo: "", code: "" });
  }
  function cancel() {
    setFlow(null);
    setError(null);
  }

  async function onSubmitContact(e: FormEvent) {
    e.preventDefault();
    if (!flow || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (flow.step === "input") {
        const value = flow.value.trim();
        if (!value) return;
        const res =
          flow.kind === "email"
            ? await startOperatorEmailChange(value.toLowerCase())
            : await startOperatorPhoneChange(value);
        setFlow({ ...flow, step: "code", sentTo: res.sentTo });
      } else {
        const code = flow.code.trim();
        if (!code) return;
        if (flow.kind === "email") await verifyOperatorEmailChange(code);
        else await verifyOperatorPhoneChange(flow.value.trim(), code);
        toast({
          tone: "success",
          title:
            flow.kind === "email" ? t("email.updated") : t("phone.updated"),
        });
        setFlow(null);
        onChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "");
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
                flow.step === "input" ? t("email.sendCode") : t("email.verify")
              }
              submitDisabled={
                flow.step === "input"
                  ? !flow.value.trim()
                  : !/^\d{6}$/.test(flow.code)
              }
              onOpenChange={(next) => {
                if (!next && !busy) cancel();
              }}
              onSubmit={onSubmitContact}
            >
              {flow.step === "input" ? (
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
                  <p className="text-body-sm text-muted-foreground">
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
          <PasswordCard onDone={onPasswordChanged} />

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
            <p className="text-body-sm text-muted-foreground">
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

function PasswordCard({ onDone }: { onDone: () => void }) {
  const policyText = useTranslations("accountsForms");
  const t = useTranslations("operatorAccount");
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!validNewPassword(next, "workforce")) {
      setError(policyText("password_policy_workforce"));
      return;
    }
    if (next !== confirm) {
      setError(t("password.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changeOperatorPassword(current, next);
      reset();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountSection
      title={t("password.title")}
      icon="key"
      action={
        !open ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(true)}
          >
            {t("password.change")}
          </Button>
        ) : undefined
      }
    >
      <DialogForm
        open={open}
        size="sm"
        title={t("password.change")}
        description={policyText("security_change_consequence")}
        submitting={busy}
        pendingLabel={policyText("processing")}
        cancelLabel={t("email.cancel")}
        submitLabel={t("password.change")}
        submitDisabled={!current || !next || !confirm}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !busy) reset();
        }}
        onSubmit={onSubmit}
      >
        <Field>
          <FieldLabel htmlFor="operatoraccountcenter-password-current">
            {t("password.current")}
          </FieldLabel>
          <PasswordInput
            id="operatoraccountcenter-password-current"
            required
            disabled={busy}
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="operatoraccountcenter-password-new">
            {t("password.new")}
          </FieldLabel>
          <PasswordInput
            id="operatoraccountcenter-password-new"
            required
            disabled={busy}
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="operatoraccountcenter-password-confirm">
            {t("password.confirm")}
          </FieldLabel>
          <PasswordInput
            id="operatoraccountcenter-password-confirm"
            required
            disabled={busy}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <p className="text-body-sm text-muted-foreground">
          {policyText("password_policy_workforce")} {t("password.hint")}
        </p>
        {error ? <Banner tone="danger" title={error} /> : null}
      </DialogForm>
    </AccountSection>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <AccountRow label={label}>{children}</AccountRow>;
}
