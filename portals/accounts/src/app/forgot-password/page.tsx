/**
 * page.tsx - /forgot-password (request an email reset link)
 * @package @vxture/accounts
 *
 * Standalone reset-request surface on the central accounts page. Off the OIDC
 * login_challenge: the user lands here from the login form's "忘记密码？" link,
 * submits their email, and the IdP mails a one-time reset link. The IdP always
 * responds 200 (anti-enumeration), so the UI shows the same "sent" state.
 * See docs/design/identity-platform-implementation.md §3 (16c), D-BE=A.
 */
"use client";

import { useState, type FormEvent } from "react";
import {
  AuthForgotPasswordPanel,
  AuthLoginTemplate,
} from "@/components/auth/AuthLogin";
import {
  AccountsAuthFooter,
  AccountsAuthHeader,
} from "@/components/AuthChrome";
import { requestPasswordReset } from "@/api/oidc";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setError("请输入邮箱");
      return;
    }
    setError(undefined);
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setResetSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      // 单栏：**招徕面用分栏，办事面用单栏。** 左边那块视觉面板的工作是把还没
      // 决定的人拉进来；到了找回密码这一步，人已经在里面了，一块营销色块只会
      // 把「填个邮箱」这件事往右推半屏。
      layout="single"
      // `useLoginLayout={false}`：`AuthForgotPasswordPanel` 自带返回按钮 + 标题 +
      // 说明，而模板的 `useLoginLayout` 会在它上面**再**画一个标题——两者的默认
      // 文案都是"重置密码"，于是这一页一直顶着两个一模一样的 h1。
      useLoginLayout={false}
    >
      <AuthForgotPasswordPanel
        email={email}
        error={error}
        loading={loading}
        resetSent={resetSent}
        onBack={() => window.history.back()}
        onChangeEmail={setEmail}
        onSubmit={onSubmit}
      />
    </AuthLoginTemplate>
  );
}
