/**
 * OperatorResetPasswordPanel.tsx - set a new operator password from a reset-link token
 * @package @vxture/accounts
 *
 * Reached via an admin-issued one-time link (/operator/reset-password?token=…).
 * Mirrors ResetPasswordPanel but enforces the operator minimum of 12 chars and,
 * on success, sends the operator to the login page (their sessions are revoked
 * server-side, so they must re-authenticate with the new password).
 */
"use client";
import { useTranslations } from "next-intl";

import { useState, type FormEvent } from "react";
import { Banner, Button } from "@vxture/design-system";
import {
  AuthField,
  AuthLoginTemplate,
  AuthPrimaryButton,
  AuthResultPanel,
} from "./auth/AuthLogin";
import { AccountsAuthFooter, AccountsAuthHeader } from "./AuthChrome";
import { resetOperatorPassword } from "@/api/oidc";

export function OperatorResetPasswordPanel({
  token,
}: {
  readonly token: string;
}) {
  const formText = useTranslations("accountsForms");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12) {
      setError(formText("use_at_least_12_characters"));
      return;
    }
    if (password !== confirm) {
      setError(formText("passwords_do_not_match"));
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      await resetOperatorPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : formText("unable_to_reset_please_try_again_later"),
      );
      setLoading(false);
    }
  };

  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      layout="single"
      title={formText("set_a_new_password")}
      description={formText("sign_in_again_after_changing_your_password")}
      useLoginLayout={!done}
    >
      {done ? (
        /* 同 ResetPasswordPanel：`.vx-auth-reset-done` / `.vx-auth-check` 已是
         * 无定义的死类名。原先"重新登录"是句子里的一个裸 <a>，在一屏只有一件
         * 事可做的终态屏上，它该是那个按钮。 */
        <AuthResultPanel
          title={formText("password_reset")}
          description={formText(
            "all_previous_sessions_have_ended_sign_in_with_your_new_password",
          )}
          action={
            <Button
              size="xl"
              className="w-full"
              onClick={() => window.location.assign("/workforce/login")}
            >
              {formText("sign_in_again")}
            </Button>
          }
        />
      ) : (
        <form
          className="flex flex-col gap-md"
          onSubmit={onSubmit}
          autoComplete="on"
        >
          <AuthField
            label={formText("new_password")}
            name="new-password"
            type="password"
            placeholder={formText("at_least_12_characters")}
            icon="lock"
            value={password}
            autoComplete="new-password"
            autoFocus
            disabled={loading}
            onChange={setPassword}
          />
          <AuthField
            label={formText("confirm_new_password")}
            name="confirm-password"
            type="password"
            placeholder={formText("enter_your_new_password_again")}
            icon="lock"
            value={confirm}
            autoComplete="new-password"
            disabled={loading}
            onChange={setConfirm}
          />
          {error ? <Banner tone="danger" title={error} /> : null}
          <AuthPrimaryButton
            loading={loading}
            label={formText("reset_password")}
            loadingLabel={formText("resetting")}
          />
        </form>
      )}
    </AuthLoginTemplate>
  );
}
