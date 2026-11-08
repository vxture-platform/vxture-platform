/**
 * ResetPasswordPanel.tsx - set a new password from a reset-link token
 * @package @vxture/accounts
 *
 * Reached via the emailed link (/reset-password?token=…). Collects + confirms a
 * new password and posts it with the token to the IdP. On success the password
 * is re-hashed (Argon2id) and the token is single-use-consumed.
 * See docs/design/identity-platform-implementation.md §3 (16c), D-BE=A.
 */
"use client";
import { useTranslations } from "next-intl";

import { useState, type FormEvent } from "react";
import { Banner } from "@vxture/design-system";
import {
  AuthField,
  AuthLoginTemplate,
  AuthPrimaryButton,
  AuthResultPanel,
} from "./auth/AuthLogin";
import { AccountsAuthFooter, AccountsAuthHeader } from "./AuthChrome";
import { resetPassword } from "@/api/oidc";

export function ResetPasswordPanel({ token }: { readonly token: string }) {
  const formText = useTranslations("accountsForms");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setError(formText("use_at_least_8_characters"));
      return;
    }
    if (password !== confirm) {
      setError(formText("passwords_do_not_match"));
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      await resetPassword(token, password);
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
      // 办事面，单栏。成功态自带标题，故那一支不再套 useLoginLayout——否则页面
      // 顶着"设置新密码"，正文却说"密码已重置"，两个 h1 自相矛盾。
      layout="single"
      title={formText("set_a_new_password")}
      description={formText("sign_in_again_after_changing_your_password")}
      useLoginLayout={!done}
    >
      {done ? (
        /* 原先这里是 `.vx-auth-reset-done` + `.vx-auth-check`，两个类名随遗留
         * 样式层退役后**没有任何定义**——渲染出来是一个裸的 ✓ 字符加两行无间距
         * 的文字。改用 DS 的终态屏。 */
        <AuthResultPanel
          title={formText("password_reset")}
          description={formText(
            "return_to_the_app_and_sign_in_with_your_new_password",
          )}
        />
      ) : (
        /* `<form>` 原先不带任何布局类，三个字段是靠浏览器默认样式堆在一起的，
         * 字段之间零间距。 */
        <form
          className="flex flex-col gap-md"
          onSubmit={onSubmit}
          autoComplete="on"
        >
          <AuthField
            label={formText("new_password")}
            name="new-password"
            type="password"
            placeholder={formText("at_least_8_characters")}
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
          {/* 错误原先挂在"确认新密码"字段上，但"密码至少 8 位"说的是上面那个
              字段——报错落在错误的行上，比不报还费解。提到表单级。 */}
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
