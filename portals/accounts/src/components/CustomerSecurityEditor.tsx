/**
 * CustomerSecurityEditor.tsx - proof-bound customer security actions.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";
import { validNewPassword } from "@/lib/password-policy";

import { PasswordInput } from "./PasswordInput";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime, formatDay } from "@vxture-platform/shared";
import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  DialogForm,
  Icon,
  Input,
  useToast,
  StatusBadge,
  Switch,
} from "@vxture/design-system";
import { fetchEnabledProviders } from "@/api/oidc";
import { accountsRequest, type CustomerSecurity } from "@/api/customer-self";
import { AccountSection, AccountRow } from "./AccountPrimitives";
import { CustomerMfaPanel } from "./CustomerMfaPanel";
import { VerificationCodeInput } from "./VerificationCodeInput";
import { useAccountCompletion } from "./AccountCenterShell";
import { AccountReauthentication } from "./AccountReauthentication";

import {
  SecurityVerification,
  useSecurityVerificationControls,
} from "./SecurityVerification";
import {
  securityVerificationOptions,
  startSecurityVerification,
  verifySecurityTicket,
} from "@/api/security-verification";

type Action = { operation: string; title: string; target?: string };

// ============================================================================
// Verified sensitive operations
// ============================================================================
/** Keep both verification stages and execution tied to the server challenge. */
export function CustomerSecurityEditor({
  security,
  onSaved,
}: {
  security: CustomerSecurity;
  onSaved: () => void;
}) {
  const verification = useSecurityVerificationControls();
  const locale = useLocale();
  const { toast } = useToast();
  const formText = useTranslations("accountsForms");
  const beginCompletion = useAccountCompletion();
  const [enabledProviders, setEnabledProviders] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    void fetchEnabledProviders().then((list) => {
      if (active) setEnabledProviders(list.map((provider) => provider.code));
    });
    return () => {
      active = false;
    };
  }, []);
  const [action, setAction] = useState<Action | null>(null);
  const [target, setTarget] = useState("");
  const [passwordIssue, setPasswordIssue] = useState("");
  const [confirmationIssue, setConfirmationIssue] = useState("");
  const [challenge, setChallenge] = useState("");
  const [stage, setStage] = useState("start");
  const [code, setCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accountChangeable =
    !security.accountChangeableAt ||
    Date.parse(security.accountChangeableAt) <= Date.now();
  function open(next: Action) {
    setAction(next);
    setTarget(next.target ?? "");
    setStage("start");
    setChallenge("");
    setCode("");
    setCurrentPassword("");
    setPassword("");
    setConfirmation("");
    setError("");
    setPasswordIssue("");
    setConfirmationIssue("");
  }
  const base = "/oidc/customer/self/security/challenges";
  async function execute(id: string) {
    if (!action) return;
    const completion =
      action.operation === "username" ? null : beginCompletion();
    try {
      const result = await accountsRequest<{ reauthenticate: boolean }>(
        `${base}/${id}/execute`,
        {
          method: "POST",
          body: JSON.stringify({ currentPassword, password }),
        },
      );
      if (result.reauthenticate)
        completion?.complete(<AccountReauthentication />);
      else {
        completion?.cancel();
        toast({ tone: "success", title: formText("saved") });
        setAction(null);
        onSaved();
      }
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
    } catch (error) {
      completion?.cancel();
      setStage("start");
      setChallenge("");
      throw error;
    }
  }
  async function begin(proofToken?: string) {
    if (!action) return;
    const result = await accountsRequest<{
      challengeId: string;
      stage: string;
    }>(base, {
      method: "POST",
      body: JSON.stringify({ operation: action.operation, target, proofToken }),
    });
    setChallenge(result.challengeId);
    setCode("");
    setStage(result.stage);
    if (result.stage === "target-pending") {
      await accountsRequest(`${base}/${result.challengeId}/target`, {
        method: "POST",
        body: "{}",
      });
      setStage("target");
    } else if (
      result.stage === "authorized" &&
      ["username", "password"].includes(action.operation)
    ) {
      await execute(result.challengeId);
    }
  }
  async function run() {
    if (!action || busy || stage === "verification") return;
    setBusy(true);
    setError("");
    try {
      if (stage === "start") {
        if (action.operation === "username") {
          if (!accountChangeable)
            throw new Error(formText("account_change_cooldown"));
          if (!/^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(target.trim()))
            throw new Error(formText("account_format_hint"));
          if (target.trim().toLowerCase() === security.account.toLowerCase())
            throw new Error(formText("account_unchanged"));
        }
        if (action.operation === "password") {
          const issue = validNewPassword(password, "customer")
            ? ""
            : formText("password_policy_customer");
          const mismatch =
            password === confirmation ? "" : formText("password_mismatch");
          setPasswordIssue(issue);
          setConfirmationIssue(mismatch);
          if (issue || mismatch) return;
        }
        if (
          ["username", "phone-verify", "email-verify"].includes(
            action.operation,
          )
        ) {
          await begin();
        } else if (action.operation === "password" && security.hasPassword) {
          const scope = {
            realm: "customer" as const,
            operation: action.operation,
            target: "",
          };
          const options = await securityVerificationOptions(scope);
          if (options.methods.includes("password")) {
            const ticket = await startSecurityVerification(scope, "password");
            const proof = await verifySecurityTicket(
              scope,
              ticket.verificationId,
              { password: currentPassword },
            );
            await begin(proof.proofToken);
          } else setStage("verification");
        } else setStage("verification");
      } else if (stage === "anchor" || stage === "target") {
        await accountsRequest(
          `${base}/${challenge}/${stage === "target" ? "target/" : ""}verify`,
          {
            method: "POST",
            body: JSON.stringify({ code }),
          },
        );
        setCode("");
        setStage("authorized");
        await execute(challenge);
      } else if (stage === "target-pending") {
        await accountsRequest(`${base}/${challenge}/target`, {
          method: "POST",
          body: "{}",
        });
        setStage("target");
      } else if (action.operation === "identity-link") {
        const result = await accountsRequest<{ url: string }>(
          "/oidc/customer/self/security/identity-link",
          {
            method: "POST",
            body: JSON.stringify({
              provider: action.target,
              challengeId: challenge,
            }),
          },
        );
        window.location.assign(result.url);
      } else await execute(challenge);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : formText("unable_to_complete_this_action"),
      );
      // Consumed challenges cannot be retried. Keep the entered password fields for correction.
      if (stage === "authorized" || stage === "anchor" || stage === "target") {
        setStage("start");
        setChallenge("");
      }
    } finally {
      setBusy(false);
    }
  }
  const providers = [
    { code: "feishu", name: formText("feishu"), logo: "feishu-logo-icon.svg" },
    {
      code: "dingtalk",
      name: formText("dingtalk"),
      logo: "dingtalk-logo-icon.svg",
    },
    { code: "wechat", name: formText("wechat"), logo: "wechat_logo_icon.svg" },
  ];
  return (
    <>
      <AccountSection title={formText("authentication")} icon="shield-check">
        <AccountRow
          label={formText("account")}
          action={
            <Button
              variant="ghost"
              size="sm"
              disabled={!accountChangeable}
              onClick={() =>
                open({
                  operation: "username",
                  title: formText("change_account"),
                })
              }
            >
              {formText("change")}
            </Button>
          }
        >
          <div className="accounts-account-value">
            <span className="font-mono">{security.account}</span>
            <span className="text-body-small text-muted-foreground">
              {accountChangeable
                ? formText("account_change_interval")
                : formText("account_next_change", {
                    date: formatDateTime(security.accountChangeableAt, locale),
                  })}
            </span>
          </div>
        </AccountRow>
        <AccountRow
          label={formText("password")}
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                open({
                  operation: "password",
                  title: security.hasPassword
                    ? formText("change_password")
                    : formText("set_password"),
                })
              }
            >
              {security.hasPassword ? formText("change") : formText("set_up")}
            </Button>
          }
        >
          {security.hasPassword ? formText("set") : formText("not_set")}
        </AccountRow>
        <AccountRow
          label={formText("phone")}
          action={
            <div className="flex gap-xs">
              {!security.phoneVerified ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    open({
                      operation: "phone-verify",
                      title: formText("verify_phone"),
                    })
                  }
                >
                  {formText("verify")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  open({
                    operation: "phone-change",
                    title: formText("change_phone"),
                  })
                }
              >
                {formText("change_contact")}
              </Button>
            </div>
          }
        >
          <span>
            {security.phone} ·{" "}
            {security.phoneVerified
              ? formText("verified")
              : formText("unverified")}
          </span>
        </AccountRow>
        <AccountRow
          label={formText("email")}
          action={
            <div className="flex gap-xs">
              {security.email && !security.emailVerified ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    open({
                      operation: "email-verify",
                      title: formText("verify_email"),
                    })
                  }
                >
                  {formText("verify")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  open({
                    operation: "email-change",
                    title: formText("change_email"),
                  })
                }
              >
                {formText("change_contact")}
              </Button>
            </div>
          }
        >
          {security.email || formText("not_connected")} ·{" "}
          {security.emailVerified
            ? formText("verified")
            : formText("unverified")}
        </AccountRow>
      </AccountSection>
      <AccountSection title={formText("login_permissions")} icon="key">
        <AccountRow
          label={formText("account_login")}
          action={
            <Switch
              aria-label={formText("account_login")}
              checked={security.accountLoginEnabled}
              disabled={!security.hasPassword}
              onCheckedChange={(enabled) =>
                open({
                  operation: "account-login",
                  title: enabled
                    ? formText("enable_account_login")
                    : formText("disable_account_login"),
                  target: String(enabled),
                })
              }
            />
          }
        >
          <div className="accounts-account-value">
            <span>
              {!security.hasPassword
                ? formText("login_unavailable")
                : security.accountLoginEnabled
                  ? formText("enabled")
                  : formText("disabled")}
            </span>
            {!security.hasPassword ? (
              <span className="text-muted-foreground">
                {formText("password_not_set")}
              </span>
            ) : null}
          </div>
        </AccountRow>
        <AccountRow
          label={formText("phone_login")}
          action={
            <Switch aria-label={formText("phone_login")} checked disabled />
          }
        >
          <div className="accounts-account-value">
            <span>
              {security.phoneVerified
                ? formText("enabled")
                : formText("login_unavailable")}
            </span>
            <span className="text-muted-foreground">
              {security.phoneVerified
                ? formText("always_enabled")
                : formText("phone_not_yet_verified")}
            </span>
          </div>
        </AccountRow>
        <AccountRow
          label={formText("email_login")}
          action={
            <Switch
              aria-label={formText("email_login")}
              checked={security.emailLoginEnabled}
              disabled={!security.emailVerified || !security.phoneVerified}
              onCheckedChange={(enabled) =>
                open({
                  operation: "email-login",
                  title: enabled
                    ? formText("enable_email_login")
                    : formText("disable_email_login"),
                  target: String(enabled),
                })
              }
            />
          }
        >
          <div className="accounts-account-value">
            <span>
              {!security.emailVerified || !security.phoneVerified
                ? formText("login_unavailable")
                : security.emailLoginEnabled
                  ? formText("enabled")
                  : formText("disabled")}
            </span>
            {!security.emailVerified || !security.phoneVerified ? (
              <span className="text-muted-foreground">
                {!security.emailVerified
                  ? formText("email_not_verified")
                  : formText("phone_not_yet_verified")}
              </span>
            ) : null}
          </div>
        </AccountRow>
      </AccountSection>
      <CustomerMfaPanel />
      <AccountSection
        title={formText("connected_accounts")}
        icon="plugs-connected"
      >
        {providers.map((provider) => {
          const connected = security.identities.find(
            (identity) => identity.provider === provider.code,
          );
          return (
            <AccountRow
              key={provider.code}
              label={
                <span className="accounts-provider-label">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/brand/${provider.logo}`}
                    alt=""
                    width={20}
                    height={20}
                  />
                  {provider.name}
                </span>
              }
              action={
                connected ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      open({
                        operation: "identity-unlink",
                        title: formText("disconnect_provider", {
                          provider: provider.name,
                        }),
                        target: provider.code,
                      })
                    }
                  >
                    <Icon name="x" size="xs" />
                    {formText("disconnect")}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={
                      !enabledProviders.includes(provider.code) ||
                      provider.code === "wechat"
                    }
                    onClick={() =>
                      open({
                        operation: "identity-link",
                        title: formText("connect_provider", {
                          provider: provider.name,
                        }),
                        target: provider.code,
                      })
                    }
                  >
                    {formText("connect")}
                  </Button>
                )
              }
            >
              <span className="accounts-provider-value">
                <StatusBadge tone={connected ? "success" : "neutral"}>
                  {connected
                    ? formText("connected")
                    : formText("not_connected")}
                </StatusBadge>
                {connected ? (
                  <span className="text-muted-foreground">
                    {formatDay(connected.connectedAt, locale)}
                  </span>
                ) : null}
              </span>
            </AccountRow>
          );
        })}
      </AccountSection>
      <DialogForm
        footerNote={
          action?.operation === "password"
            ? formText("password_relogin_hint")
            : action?.operation === "username"
              ? formText("account_change_interval")
              : undefined
        }
        size="sm"
        title={action?.title}
        danger={
          action?.operation === "identity-unlink" ||
          (["account-login", "email-login"].includes(action?.operation ?? "") &&
            action?.target === "false")
        }
        description={
          action?.operation === "password" || action?.operation === "username"
            ? undefined
            : action?.operation === "identity-unlink"
              ? formText("unlink_consequence")
              : ["account-login", "email-login"].includes(
                    action?.operation ?? "",
                  )
                ? formText("disable_login_consequence")
                : formText("security_change_consequence")
        }
        submitting={busy}
        cancelLabel={formText("cancel")}
        pendingLabel={formText("processing")}
        submitDisabled={
          stage === "verification"
            ? verification.disabled
            : ["anchor", "target"].includes(stage) && code.length !== 6
        }
        submitLabel={
          stage === "verification"
            ? verification.label
            : formText(
                stage === "target-pending"
                  ? "send_code"
                  : stage === "anchor" || stage === "target"
                    ? "verify"
                    : stage === "start" &&
                        action?.operation !== "username" &&
                        action?.operation !== "password"
                      ? "continue"
                      : "confirm_change",
              )
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (stage === "verification") verification.submit();
          else void run();
        }}
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <div className="accounts-settings-form">
          {stage === "verification" && action ? (
            <SecurityVerification
              key={`${action.operation}:${target}`}
              controls={verification.controls}
              realm="customer"
              operation={action.operation}
              target={target}
              onBusyChange={setBusy}
              onVerified={async (token) => {
                try {
                  await begin(token);
                } catch (reason) {
                  setStage("start");
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : formText("verification_failed"),
                  );
                  throw reason;
                }
              }}
            />
          ) : stage === "start" ? (
            <>
              {action &&
              ["phone-change", "email-change", "username"].includes(
                action.operation,
              ) ? (
                <>
                  <Input
                    id="security-new-value"
                    aria-label={formText(
                      action.operation === "username"
                        ? "new_account_name"
                        : "new_value",
                    )}
                    type={
                      action.operation === "email-change"
                        ? "email"
                        : action.operation === "phone-change"
                          ? "tel"
                          : "text"
                    }
                    maxLength={action.operation === "username" ? 24 : 128}
                    autoComplete="off"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    required
                    disabled={busy}
                    placeholder={formText(
                      action.operation === "username"
                        ? "new_account_name"
                        : action.operation === "email-change"
                          ? "new_email"
                          : "new_phone_number",
                    )}
                  />
                  {action.operation === "username" ? (
                    <p className="text-body-small text-muted-foreground">
                      {formText("account_format_hint")}
                    </p>
                  ) : null}
                </>
              ) : null}
              {action?.operation === "password" ? (
                <>
                  {security.hasPassword ? (
                    <div className="accounts-password-group">
                      <label
                        htmlFor="security-current-password"
                        className="accounts-password-group-label"
                      >
                        {formText("current_password")}
                        <span className="accounts-required" aria-hidden="true">
                          *
                        </span>
                      </label>
                      <PasswordInput
                        id="security-current-password"
                        aria-label={formText("current_password")}
                        placeholder={formText("current_password")}
                        autoComplete="current-password"
                        maxLength={128}
                        value={currentPassword}
                        onChange={(event) =>
                          setCurrentPassword(event.target.value)
                        }
                        required
                        disabled={busy}
                      />
                    </div>
                  ) : null}
                  <div className="accounts-password-group">
                    <label
                      htmlFor="security-new-password"
                      className="accounts-password-group-label"
                    >
                      {formText("new_password")}
                      <span className="accounts-required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <div className="accounts-password-field">
                      <PasswordInput
                        id="security-new-password"
                        aria-label={formText("new_password")}
                        placeholder={formText("new_password")}
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={128}
                        value={password}
                        disabled={busy}
                        required
                        aria-invalid={!!passwordIssue}
                        aria-describedby="security-password-policy"
                        onChange={(event) => {
                          setPassword(event.target.value);
                          setPasswordIssue("");
                        }}
                      />
                    </div>
                    <div className="accounts-password-field">
                      <PasswordInput
                        id="security-confirm-password"
                        aria-label={formText("confirm_password")}
                        placeholder={formText("confirm_password")}
                        autoComplete="new-password"
                        maxLength={128}
                        value={confirmation}
                        disabled={busy}
                        required
                        aria-invalid={!!confirmationIssue}
                        aria-describedby={
                          confirmationIssue
                            ? "security-password-mismatch"
                            : undefined
                        }
                        onChange={(event) => {
                          setConfirmation(event.target.value);
                          setConfirmationIssue("");
                        }}
                      />
                      {confirmationIssue ? (
                        <p
                          id="security-password-mismatch"
                          className="text-body-small text-danger"
                          role="alert"
                        >
                          {confirmationIssue}
                        </p>
                      ) : null}
                    </div>
                    <p
                      id="security-password-policy"
                      className={
                        passwordIssue
                          ? "text-body-small text-danger"
                          : "text-body-small text-muted-foreground"
                      }
                    >
                      {formText("password_policy_customer")}
                    </p>
                  </div>
                </>
              ) : null}
            </>
          ) : stage === "anchor" || stage === "target" ? (
            <>
              <p className="text-body-small text-muted-foreground">
                {stage === "target"
                  ? formText("verify_new_contact", { target })
                  : formText("verify_your_current_contact")}
              </p>
              <VerificationCodeInput
                name="security-code"
                label={formText("verification_code")}
                value={code}
                onChange={setCode}
                disabled={busy}
              />
            </>
          ) : (
            <p className="text-body-small text-muted-foreground">
              {formText(
                stage === "authorized"
                  ? action?.operation === "identity-link"
                    ? "link_verified"
                    : "verified_confirming_will_sign_out_all_devices"
                  : "send_a_code_to_the_new_contact",
              )}
            </p>
          )}
          {error ? <Banner tone="danger" title={error} /> : null}
        </div>
      </DialogForm>
    </>
  );
}
