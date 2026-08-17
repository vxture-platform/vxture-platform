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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 12) {
      setError("密码至少 12 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      await resetOperatorPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败，请稍后重试");
      setLoading(false);
    }
  };

  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      layout="single"
      title="设置运营账号新密码"
      description="运营密码至少 12 位。重置后当前账号的全部会话都会失效，需要重新登录。"
      useLoginLayout={!done}
    >
      {done ? (
        /* 同 ResetPasswordPanel：`.vx-auth-reset-done` / `.vx-auth-check` 已是
         * 无定义的死类名。原先"重新登录"是句子里的一个裸 <a>，在一屏只有一件
         * 事可做的终态屏上，它该是那个按钮。 */
        <AuthResultPanel
          title="密码已重置"
          description="原有会话已全部失效，请使用新密码重新登录。"
          action={
            <Button
              size="xl"
              className="w-full"
              onClick={() => window.location.assign("/login")}
            >
              重新登录
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
            label="新密码"
            name="new-password"
            type="password"
            placeholder="至少 12 位"
            icon="lock"
            value={password}
            autoComplete="new-password"
            autoFocus
            disabled={loading}
            onChange={setPassword}
          />
          <AuthField
            label="确认新密码"
            name="confirm-password"
            type="password"
            placeholder="再次输入新密码"
            icon="lock"
            value={confirm}
            autoComplete="new-password"
            disabled={loading}
            onChange={setConfirm}
          />
          {error ? <Banner tone="danger" title={error} /> : null}
          <AuthPrimaryButton
            loading={loading}
            label="重置密码"
            loadingLabel="重置中..."
          />
        </form>
      )}
    </AuthLoginTemplate>
  );
}
