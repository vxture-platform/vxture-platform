/**
 * BindPhonePanel.tsx - bind a verified phone to a social login (no-phone upstream).
 * @package @vxture/accounts
 *
 * Reached after a social login whose upstream returned no phone (e.g. Google):
 * /bind-phone?binding_token=…. Collects phone + SMS code (Turnstile-gated send,
 * same as the login phone tab), posts them with the binding token, and navigates
 * to the RP redirect on success. See docs/design/identity-platform-account.md §5.
 */
"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  AuthLoginTemplate,
  AuthPhoneLoginPanel,
  AuthTurnstile,
} from "./auth/AuthLogin";
import { AccountsAuthFooter, AccountsAuthHeader } from "./AuthChrome";
import { bindOAuthPhone, sendPhoneCode } from "@/api/oidc";

const TENANT_TURNSTILE_KEY =
  process.env.NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY ?? "";
const PHONE_RE = /^1[3-9]\d{9}$/;

export function BindPhonePanel({ token }: { readonly token: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const resetTurnstile = () => {
    if (!TENANT_TURNSTILE_KEY) return;
    setTurnstileToken("");
    setTurnstileResetSignal((v) => v + 1);
  };

  const handleSendCode = async () => {
    const next: Record<string, string> = {};
    if (!PHONE_RE.test(phone.trim())) next.phone = "请输入有效的手机号";
    if (TENANT_TURNSTILE_KEY && !turnstileToken) next.form = "请先完成人机验证";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSending(true);
    try {
      await sendPhoneCode(phone.trim(), turnstileToken);
      setCountdown(60);
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "发送失败" });
    } finally {
      setSending(false);
      resetTurnstile();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!PHONE_RE.test(phone.trim())) next.phone = "请输入有效的手机号";
    if (code.trim().length !== 6) next.code = "请输入 6 位验证码";
    if (!agreed) next.form = "请先阅读并同意用户协议和隐私政策";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      const { redirectTo } = await bindOAuthPhone(
        token,
        phone.trim(),
        code.trim(),
      );
      window.location.assign(redirectTo);
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : "绑定失败，请重试",
      });
      setLoading(false);
    }
  };

  const turnstileNode = TENANT_TURNSTILE_KEY ? (
    <AuthTurnstile
      siteKey={TENANT_TURNSTILE_KEY}
      action="tenant_auth"
      resetSignal={turnstileResetSignal}
      onToken={(t) => setTurnstileToken(t)}
      onExpire={() => setTurnstileToken("")}
      onError={() =>
        setErrors((c) => ({ ...c, form: "人机验证加载失败，请刷新重试" }))
      }
    />
  ) : null;

  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      // 办事面，单栏。到这一步三方登录已经过了，只差一个手机号。
      layout="single"
      title="绑定手机号"
      description="你的第三方账号没有带回手机号。验证一个手机号后即可完成登录，之后也用它找回账号。"
      useLoginLayout
    >
      <AuthPhoneLoginPanel
        phone={phone}
        code={code}
        agreementChecked={agreed}
        errors={errors}
        loading={loading}
        codeSending={sending}
        codeCountdown={countdown}
        sendCodeDisabled={countdown > 0 || sending}
        turnstile={turnstileNode}
        submitLabel="绑定并登录"
        // 这两条是从登录面板的缺省值继承来的，在绑手机这一页都说不通：
        // 「忘记密码？」——这里从头到尾没有密码；
        // 「记住登录信息」——记的是这一台设备上的登录，而这一步在建账号绑定。
        showForgot={false}
        options={{ showRemember: false }}
        onChangePhone={setPhone}
        onChangeCode={setCode}
        onSendCode={handleSendCode}
        onAgreementChange={setAgreed}
        onSubmit={handleSubmit}
      />
    </AuthLoginTemplate>
  );
}
