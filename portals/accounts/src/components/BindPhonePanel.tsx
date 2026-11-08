/**
 * BindPhonePanel.tsx - bind a verified phone to a social login (no-phone upstream).
 * @package @vxture/accounts
 *
 * Reached after a social login whose upstream returned no phone (e.g. Google):
 * /bind-phone?binding_token=…. Collects phone + SMS code (human-verification-gated send,
 * same as the login phone tab), posts them with the binding token, and navigates
 * to the RP redirect on success. See docs/design/identity-platform-account.md §5.
 */
"use client";
import { useTranslations } from "next-intl";

import { useEffect, useState, type FormEvent } from "react";
import { AuthLoginTemplate, AuthPhoneLoginPanel } from "./auth/AuthLogin";
import { AccountsAuthFooter, AccountsAuthHeader } from "./AuthChrome";
import { bindOAuthPhone, sendBindPhoneCode } from "@/api/oidc";
import { useHumanCaptcha } from "./HumanCaptcha";

const PHONE_RE = /^1[3-9]\d{9}$/;

export function BindPhonePanel({ token }: { readonly token: string }) {
  const formText = useTranslations("accountsForms");

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const captcha = useHumanCaptcha("customer");
  const [sentCodeTarget, setSentCodeTarget] = useState("");

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleSendCode = async () => {
    const next: Record<string, string> = {};
    if (!PHONE_RE.test(phone.trim()))
      next.phone = formText("enter_a_valid_phone_number_2");
    if (!captcha.ready)
      next.form = formText("complete_the_human_verification_first");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSending(true);
    try {
      await sendBindPhoneCode(token, phone.trim(), captcha.token);
      setCountdown(60);
      setSentCodeTarget(phone.trim());
    } catch (error) {
      setErrors({
        form:
          error instanceof Error ? error.message : formText("unable_to_send"),
      });
    } finally {
      setSending(false);
      captcha.reset();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!PHONE_RE.test(phone.trim()))
      next.phone = formText("enter_a_valid_phone_number_2");
    if (code.trim().length !== 6)
      next.code = formText("enter_the_6_digit_code");
    if (!sentCodeTarget || sentCodeTarget !== phone.trim())
      next.form = formText("request_a_verification_code_first");
    if (!agreed)
      next.form = formText("please_accept_the_terms_and_privacy_policy");
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
        form:
          error instanceof Error
            ? error.message
            : formText("unable_to_connect_please_try_again"),
      });
      setLoading(false);
    }
  };

  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      // 办事面，单栏。到这一步三方登录已经过了，只差一个手机号。
      layout="single"
      title={formText("connect_phone_number")}
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
        sendCodeDisabled={countdown > 0 || sending || !captcha.ready}
        verification={captcha.node}
        primaryDisabled={
          !sentCodeTarget || sentCodeTarget !== phone.trim() || !agreed
        }
        submitLabel={formText("connect_and_sign_in")}
        // 这两条是从登录面板的缺省值继承来的，在绑手机这一页都说不通：
        // 「忘记密码？」——这里从头到尾没有密码；
        // 「记住登录信息」——记的是这一台设备上的登录，而这一步在建账号绑定。
        showForgot={false}
        options={{ showRemember: false }}
        onChangePhone={(value) => {
          setPhone(value);
          setCode("");
          setSentCodeTarget("");
        }}
        onChangeCode={setCode}
        onSendCode={handleSendCode}
        onAgreementChange={setAgreed}
        onSubmit={handleSubmit}
      />
    </AuthLoginTemplate>
  );
}
