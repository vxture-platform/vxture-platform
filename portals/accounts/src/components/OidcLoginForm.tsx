/**
 * OidcLoginForm.tsx - realm-driven OIDC interactive login form
 * @package @vxture/accounts
 *
 * Renders the IdP login page on the accounts surface. Reads a parked
 * login_challenge + realm, collects credentials, and completes the challenge.
 * Tenant realm offers verification-code (phone OR email, smart-detected — the
 * default/left tab) + password (account/phone/email) via the design-system
 * login panels; operator realm is password-only (no code/social/register). See
 * docs/design/identity-platform-idp.md §5 + identity-platform-account.md.
 */
"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AuthChromeFooter,
  AuthChromeHeader,
  AuthLoginTemplate,
  AuthPasswordLoginPanel,
  AuthPhoneLoginPanel,
  AuthTabs,
  AuthTurnstile,
  type AuthLoginTab,
} from "@vxture/design-system";
import { rememberRpOrigin, resolveReturnUrl } from "@vxture/platform-browser";
import {
  SessionExpiredError,
  completeOidcLogin,
  completeOidcLoginWithEmail,
  completeOidcLoginWithPhone,
  resumeOidcLogin,
  sendEmailCode,
  sendPhoneCode,
  type OidcMfaRequired,
} from "@/api/oidc";
import { OperatorMfaFlow } from "./OperatorMfaFlow";
import { SocialLoginButtons } from "./SocialLoginButtons";

const WEBSITE_HOME_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "";

type Realm = "customer" | "workforce";

interface OidcLoginFormProps {
  readonly loginChallenge: string;
  readonly realm: Realm;
}

const TENANT_TURNSTILE_KEY =
  process.env.NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY ?? "";
// Operator surface reuses the existing ops/admin Turnstile (运营面), not a new key.
const OPERATOR_TURNSTILE_KEY =
  process.env.NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_KEY ?? "";

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Smart-detect the verification-code channel from the identifier (D-CC). */
function detectCodeChannel(value: string): "phone" | "email" | null {
  const trimmed = value.trim();
  if (PHONE_RE.test(trimmed)) return "phone";
  if (EMAIL_RE.test(trimmed)) return "email";
  return null;
}

export function OidcLoginForm({ loginChallenge, realm }: OidcLoginFormProps) {
  const isOperator = realm === "workforce";
  const turnstileKey = isOperator
    ? OPERATOR_TURNSTILE_KEY
    : TENANT_TURNSTILE_KEY;
  const turnstileAction = isOperator ? "operator_auth" : "tenant_auth";

  // Verification-code login is the primary mode (D-CA); the "phone" tab value now
  // denotes the unified phone-or-email code tab. Operator realm has no tabs and
  // is forced to password below.
  const [mode, setMode] = useState<AuthLoginTab>(
    isOperator ? "login" : "phone",
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  // Phone OR email for the verification-code tab (smart-detected, D-CC).
  const [codeId, setCodeId] = useState("");
  const [code, setCode] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  // Whether a code has actually been sent this session — gates the code-login
  // submit button so it can't be clicked before a code exists to check.
  const [codeSent, setCodeSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  // The current token was already consumed by a send-code call (single-use
  // server-side) — the next resend needs a fresh one, not this one.
  const [turnstileConsumed, setTurnstileConsumed] = useState(false);
  // Set while waiting for a fresh token after resetTurnstile() so the code can
  // actually be (re)sent once it arrives (or once Turnstile degrades to best-effort).
  const pendingResendRef = useRef(false);
  // Graceful degradation: if the Turnstile widget can't load/complete (e.g. the
  // Cloudflare script is unreachable), don't hard-block login — treat it as
  // best-effort. The server still enforces when CF_TURNSTILE_ENABLED is on.
  const [turnstileFailed, setTurnstileFailed] = useState(false);
  // Fallback: if the widget yields neither a token nor an error within a grace
  // window (script blocked/hung), degrade too so login is never stuck.
  useEffect(() => {
    if (!turnstileKey || turnstileToken || turnstileFailed) return undefined;
    const t = setTimeout(() => setTurnstileFailed(true), 12000);
    return () => clearTimeout(t);
  }, [turnstileKey, turnstileToken, turnstileFailed]);
  // Set when an operator first factor succeeds but a second factor is owed.
  const [mfaChallenge, setMfaChallenge] = useState<OidcMfaRequired | null>(
    null,
  );

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Cache the referring app's origin so a later expired/missing challenge on
  // this surface can send the user back to where they actually came from.
  useEffect(() => {
    rememberRpOrigin();
  }, []);

  // Once a send-code call has consumed the current token, wait for a fresh one
  // (issued via resetTurnstile()) before actually firing the resend request.
  useEffect(() => {
    if (!pendingResendRef.current) return;
    if (!turnstileToken && !turnstileFailed) return;
    pendingResendRef.current = false;
    void doSendCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnstileToken, turnstileFailed]);

  // Cross-tab session detection: when the user logs in via another RP while this
  // login page is open, the vx_sid cookie appears on accounts.vxture.com. On
  // tab-focus or visibility-restored, probe the resume endpoint; if the central
  // session can satisfy the parked challenge, navigate without re-authenticating.
  const loadingRef = useRef(false);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (loadingRef.current || cancelled) return;
      const result = await resumeOidcLogin(loginChallenge);
      if (result && !cancelled) {
        window.location.assign(result.redirectTo);
      }
    };

    const handleFocus = () => void check();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loginChallenge]);

  const resetTurnstile = () => {
    if (!turnstileKey) return;
    setTurnstileToken("");
    setTurnstileResetSignal((v) => v + 1);
  };

  const switchMode = (m: AuthLoginTab) => {
    setMode(m);
    setErrors({});
  };

  // Common gates shared by both submit paths.
  const commonError = (): string | null => {
    if (turnstileKey && !turnstileToken && !turnstileFailed)
      return "请先完成人机验证";
    if (!acceptedTerms) return "请先阅读并同意用户协议和隐私政策";
    return null;
  };

  // The parked login_challenge is gone — there is nothing to retry inline,
  // send the user back to wherever they actually came from.
  const redirectToReturnUrl = () => {
    window.location.assign(resolveReturnUrl(WEBSITE_HOME_URL));
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!identifier.trim()) next.identifier = "请输入账号";
    if (!password) next.password = "请输入密码";
    const c = commonError();
    if (c) next.form = c;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      const result = await completeOidcLogin({
        loginChallenge,
        identifier: identifier.trim(),
        password,
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      if ("status" in result) {
        // Operator owes a second factor → hand off to the MFA continuation.
        setMfaChallenge(result);
        return;
      }
      window.location.assign(result.redirectTo);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        redirectToReturnUrl();
        return;
      }
      setErrors({
        form: error instanceof Error ? error.message : "登录失败，请重试",
      });
      resetTurnstile();
      setLoading(false);
    }
  };

  // Actually calls the send-code API once a usable Turnstile token is in hand
  // (either the page-load token on the first send, or a freshly re-verified
  // one on a resend — see handleSendCode/the pending-resend effect above).
  const doSendCode = async () => {
    const channel = detectCodeChannel(codeId);
    if (!channel) return;

    setSending(true);
    try {
      if (channel === "phone") {
        await sendPhoneCode(codeId.trim(), turnstileToken);
      } else {
        await sendEmailCode(codeId.trim(), turnstileToken);
      }
      setCountdown(60);
      setCodeSent(true);
      // This token is now spent server-side; only a resend after it expires
      // needs a new one, so don't force a visible re-verification yet.
      setTurnstileConsumed(true);
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "发送失败" });
    } finally {
      setSending(false);
    }
  };

  const handleSendCode = async () => {
    const next: Record<string, string> = {};
    const channel = detectCodeChannel(codeId);
    if (!channel) next.phone = "请输入有效的手机号或邮箱";
    if (turnstileKey && !turnstileToken && !turnstileFailed)
      next.form = "请先完成人机验证";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (turnstileConsumed && turnstileKey) {
      // Resending: the held token was already used for the previous send —
      // get a fresh one (this is the only case Turnstile re-verifies).
      setTurnstileConsumed(false);
      resetTurnstile();
      pendingResendRef.current = true;
      setSending(true);
      return;
    }
    await doSendCode();
  };

  const handleCodeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const channel = detectCodeChannel(codeId);
    if (!channel) next.phone = "请输入有效的手机号或邮箱";
    if (code.trim().length !== 6) next.code = "请输入 6 位验证码";
    if (!acceptedTerms) next.form = "请先阅读并同意用户协议和隐私政策";
    setErrors(next);
    if (Object.keys(next).length > 0 || !channel) return;

    setLoading(true);
    try {
      const { redirectTo } =
        channel === "phone"
          ? await completeOidcLoginWithPhone({
              loginChallenge,
              phone: codeId.trim(),
              code: code.trim(),
            })
          : await completeOidcLoginWithEmail({
              loginChallenge,
              email: codeId.trim(),
              code: code.trim(),
            });
      window.location.assign(redirectTo);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        redirectToReturnUrl();
        return;
      }
      setErrors({
        form: error instanceof Error ? error.message : "登录失败，请重试",
      });
      setLoading(false);
    }
  };

  // Operator second-factor continuation replaces the login form entirely.
  if (mfaChallenge) {
    return (
      <OperatorMfaFlow
        mfaToken={mfaChallenge.mfaToken}
        methods={mfaChallenge.methods}
        enrollRequired={mfaChallenge.enrollRequired}
        enrollFactor={mfaChallenge.enrollFactor}
      />
    );
  }

  const turnstileNode = turnstileKey ? (
    <AuthTurnstile
      siteKey={turnstileKey}
      action={turnstileAction}
      resetSignal={turnstileResetSignal}
      onToken={(token) => setTurnstileToken(token)}
      onExpire={() => setTurnstileToken("")}
      onError={() => setTurnstileFailed(true)}
    />
  ) : null;

  // Tenant realm offers code + password tabs (verification-code first, D-CA);
  // operator is password-only.
  const tabsNode = isOperator ? undefined : (
    <AuthTabs active={mode} onChange={switchMode} order={["phone", "login"]} />
  );

  // Social login is tenant-only (operator has no third-party login). The buttons
  // self-hide when no provider is enabled (table-driven).
  const socialNode = isOperator ? undefined : (
    <SocialLoginButtons loginChallenge={loginChallenge} />
  );

  const turnstileReady =
    Boolean(turnstileToken) || turnstileFailed || !turnstileKey;
  // Code-login submit never re-checks Turnstile server-side (D-CA), but the
  // button itself still waits for a code to have actually been sent + a token
  // to have been available at some point, matching the password path's gate.
  const codeCanSubmit =
    codeSent &&
    Boolean(detectCodeChannel(codeId)) &&
    code.trim().length === 6 &&
    acceptedTerms &&
    turnstileReady;
  const passwordCanSubmit =
    identifier.trim().length > 0 &&
    password.length > 0 &&
    acceptedTerms &&
    turnstileReady;

  return (
    <AuthLoginTemplate
      header={<AuthChromeHeader brandLabel="Vxture" />}
      footer={<AuthChromeFooter />}
      title={isOperator ? "运营登录" : "Welcome to Vxture"}
      useLoginLayout
    >
      {!isOperator && mode === "phone" ? (
        <AuthPhoneLoginPanel
          tabs={tabsNode}
          phone={codeId}
          code={code}
          agreementChecked={acceptedTerms}
          errors={errors}
          loading={loading}
          codeSending={sending}
          codeCountdown={countdown}
          sendCodeDisabled={countdown > 0 || sending}
          turnstile={turnstileNode}
          social={socialNode}
          showForgot={false}
          submitLabel="登录 / 注册"
          primaryDisabled={!codeCanSubmit}
          phoneLabel="手机号 / 邮箱"
          phonePlaceholder="请输入手机号或邮箱"
          phoneInputType="text"
          phoneIcon="user"
          phoneAutoComplete="username"
          options={{ showRemember: false }}
          onChangePhone={setCodeId}
          onChangeCode={setCode}
          onSendCode={handleSendCode}
          onAgreementChange={setAcceptedTerms}
          onSubmit={handleCodeSubmit}
        />
      ) : (
        <AuthPasswordLoginPanel
          tabs={tabsNode}
          identifier={identifier}
          password={password}
          agreementChecked={acceptedTerms}
          errors={errors}
          loading={loading}
          turnstile={turnstileNode}
          social={socialNode}
          showForgot={!isOperator}
          primaryDisabled={!passwordCanSubmit}
          identifierPlaceholder={
            isOperator ? "运营账号" : "邮箱 / 用户名 / 手机号"
          }
          options={{ showRemember: false }}
          onChangeIdentifier={setIdentifier}
          onChangePassword={setPassword}
          onAgreementChange={setAcceptedTerms}
          onForgot={
            isOperator
              ? undefined
              : () => window.location.assign("/forgot-password")
          }
          onSubmit={handlePasswordSubmit}
        />
      )}
    </AuthLoginTemplate>
  );
}
