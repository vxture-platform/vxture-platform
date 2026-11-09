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

import { useLocale, useTranslations } from "next-intl";
import { formatDay } from "@vxture-platform/shared";
import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  DialogForm,
  Icon,
  Input,
  NativeSelect,
  StatusBadge,
  Switch,
} from "@vxture/design-system";
import { fetchEnabledProviders } from "@/api/oidc";
import { accountsRequest, type CustomerSecurity } from "@/api/customer-self";
import { AccountSection, AccountRow } from "./AccountPrimitives";
import { CustomerMfaPanel } from "./CustomerMfaPanel";
import { VerificationCodeInput } from "./VerificationCodeInput";

type Action = { operation: string; title: string; target?: string };

// ============================================================================
// Verified sensitive operations
// ============================================================================
/** Keep both verification stages and execution tied to the server challenge. */
export function CustomerSecurityEditor({
  security,
}: {
  security: CustomerSecurity;
}) {
  const locale = useLocale();
  const formText = useTranslations("accountsForms");
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
  const [method, setMethod] = useState("phone");
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
    setMethod(next.operation === "email-verify" ? "email" : "phone");
  }
  async function run() {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    const base = "/oidc/customer/self/security/challenges";
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
        if (
          action.operation === "password" &&
          (!validNewPassword(password, "customer") || password !== confirmation)
        )
          throw new Error(formText("password_policy_customer"));
        const result = await accountsRequest<{ challengeId: string }>(base, {
          method: "POST",
          body: JSON.stringify({ operation: action.operation, method, target }),
        });
        setChallenge(result.challengeId);
        setStage("anchor");
      } else if (stage === "anchor" || stage === "target") {
        const result = await accountsRequest<{ stage: string }>(
          `${base}/${challenge}/${stage === "target" ? "target/" : ""}verify`,
          { method: "POST", body: JSON.stringify({ code }) },
        );
        setCode("");
        if (result.stage === "target-pending") {
          setStage("target-pending");
          await accountsRequest(`${base}/${challenge}/target`, {
            method: "POST",
            body: "{}",
          });
          setStage("target");
        } else setStage("authorized");
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
      } else {
        await accountsRequest(`${base}/${challenge}/execute`, {
          method: "POST",
          body: JSON.stringify({ currentPassword, password }),
        });
        setStage("done");
        setCurrentPassword("");
        setPassword("");
        setConfirmation("");
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
            <span className="text-body-sm text-muted-foreground">
              {accountChangeable
                ? formText("account_change_interval")
                : formText("account_next_change", {
                    date: new Date(
                      security.accountChangeableAt!,
                    ).toLocaleString(locale),
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
          {security.accountLoginEnabled
            ? formText("enabled")
            : formText("disabled")}
        </AccountRow>
        <AccountRow
          label={formText("phone_login")}
          action={
            <Switch aria-label={formText("phone_login")} checked disabled />
          }
        >
          <span className="text-muted-foreground">
            {formText("always_enabled")}
          </span>
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
          <span className="text-muted-foreground">
            {security.emailVerified
              ? formText("available_for_login")
              : formText("verify_your_email_to_enable")}
          </span>
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
        size="sm"
        title={action?.title}
        submitting={busy}
        cancelLabel={formText("cancel")}
        pendingLabel={formText("processing")}
        submitDisabled={
          ["anchor", "target"].includes(stage) && code.length !== 6
        }
        submitLabel={
          stage === "done"
            ? formText("sign_in_again")
            : stage === "start" || stage === "target-pending"
              ? formText("send_code")
              : stage === "authorized"
                ? formText("confirm_change")
                : formText("continue")
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (stage === "done") window.location.assign("/login");
          else void run();
        }}
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        {stage === "done" ? (
          <>
            <Banner
              tone="success"
              title={formText("done_please_sign_in_again")}
            />
          </>
        ) : (
          <div className="accounts-settings-form">
            {stage === "start" ? (
              <>
                {action?.operation === "username" ? (
                  <>
                    <p className="text-body-sm text-muted-foreground">
                      {formText("account_change_interval")}
                    </p>
                    <label
                      className="accounts-required-label"
                      htmlFor="security-new-account"
                    >
                      {formText("new_account_name")}
                      <span className="accounts-required" aria-hidden="true">
                        *
                      </span>
                    </label>
                  </>
                ) : null}
                {action &&
                ["phone-change", "email-change", "username"].includes(
                  action.operation,
                ) ? (
                  <Input
                    id={
                      action.operation === "username"
                        ? "security-new-account"
                        : undefined
                    }
                    aria-label={formText(
                      action.operation === "username"
                        ? "new_account_name"
                        : "new_value",
                    )}
                    aria-describedby={
                      action.operation === "username"
                        ? "security-account-hint"
                        : undefined
                    }
                    maxLength={action.operation === "username" ? 24 : undefined}
                    autoComplete={
                      action.operation === "username" ? "off" : undefined
                    }
                    type={
                      action.operation === "email-change" ? "email" : "text"
                    }
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder={
                      action.operation === "phone-change"
                        ? formText("new_phone_number")
                        : action.operation === "email-change"
                          ? formText("new_email")
                          : formText("new_account_name")
                    }
                    required
                    disabled={busy}
                  />
                ) : null}
                {action?.operation === "username" ? (
                  <p
                    id="security-account-hint"
                    className="text-body-sm text-muted-foreground"
                  >
                    {formText("account_format_hint")}
                  </p>
                ) : null}
                {action?.operation === "password" ? (
                  <>
                    {security.hasPassword ? (
                      <>
                        <label
                          className="accounts-required-label"
                          htmlFor="security-current_password"
                        >
                          {formText("current_password")}
                          <span
                            className="accounts-required"
                            aria-hidden="true"
                          >
                            *
                          </span>
                        </label>
                        <Input
                          id="security-current_password"
                          aria-label={formText("current_password")}
                          type="password"
                          autoComplete="current-password"
                          placeholder={formText("current_password")}
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                        />
                      </>
                    ) : null}
                    <label
                      className="accounts-required-label"
                      htmlFor="security-new_password"
                    >
                      {formText("new_password")}
                      <span className="accounts-required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <Input
                      id="security-new_password"
                      aria-label={formText("new_password")}
                      type="password"
                      autoComplete="new-password"
                      placeholder={formText(
                        "new_password_at_least_8_characters",
                      )}
                      minLength={8}
                      maxLength={128}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                    <p className="text-body-sm text-muted-foreground">
                      {formText("password_policy_customer")}
                    </p>
                    <label
                      className="accounts-required-label"
                      htmlFor="security-confirm_password"
                    >
                      {formText("confirm_password")}
                      <span className="accounts-required" aria-hidden="true">
                        *
                      </span>
                    </label>
                    <Input
                      id="security-confirm_password"
                      aria-label={formText("confirm_password")}
                      type="password"
                      autoComplete="new-password"
                      placeholder={formText("confirm_password")}
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      required
                    />
                  </>
                ) : null}
                <label className="text-body-sm text-muted-foreground">
                  {formText("verification_method")}
                  <NativeSelect
                    aria-label={formText("verification_method")}
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    disabled={busy || action?.operation.endsWith("-verify")}
                  >
                    <option
                      value="phone"
                      disabled={
                        !security.phoneVerified &&
                        action?.operation !== "phone-verify"
                      }
                    >
                      {formText("sms_code")}
                    </option>
                    <option
                      value="email"
                      disabled={
                        !security.emailVerified &&
                        action?.operation !== "email-verify"
                      }
                    >
                      {formText("email_code")}
                    </option>
                  </NativeSelect>
                </label>
              </>
            ) : stage === "anchor" || stage === "target" ? (
              <>
                <p className="text-body-sm text-muted-foreground">
                  {stage === "anchor"
                    ? formText("verify_your_current_contact")
                    : formText("verify_new_contact", { target })}
                </p>
                <VerificationCodeInput
                  name="security_code"
                  label={formText("verification_code")}
                  value={code}
                  onChange={setCode}
                  disabled={busy}
                />
              </>
            ) : (
              <p className="text-body-sm text-muted-foreground">
                {stage === "authorized"
                  ? action?.operation === "identity-link"
                    ? formText("link_verified")
                    : formText("verified_confirming_will_sign_out_all_devices")
                  : formText("send_a_code_to_the_new_contact")}
              </p>
            )}
            {error ? <Banner tone="danger" title={error} /> : null}
          </div>
        )}
      </DialogForm>
    </>
  );
}
