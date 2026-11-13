/**
 * OidcLoginForm.tsx - realm-driven OIDC interactive login form
 * @package @vxture/accounts
 *
 * Renders the IdP login page on the accounts surface. Reads a parked
 * login_challenge + realm, collects credentials, and completes the challenge.
 * Tenant realm offers verification-code (phone OR email, smart-detected — the
 * default/left tab) + password (account/phone/email) via the design-system
 * login panels; workforce uses phone or password followed by mandatory MFA. See
 * docs/design/identity-platform-idp.md §5 + identity-platform-account.md.
 */
"use client";
import { useTranslations } from "next-intl";
import { Button } from "@vxture/design-system";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AuthLoginTemplate,
  AuthPasswordLoginPanel,
  AuthPhoneLoginPanel,
  AuthTabs,
  type AuthLoginTab,
} from "./auth/AuthLogin";
import {
  ACCOUNTS_AUTH_VISUAL,
  AccountsAuthFooter,
  AccountsAuthHeader,
  AccountsNotice,
} from "./AuthChrome";
import {
  rememberRpOrigin,
  resolveRealmReturnOrigin,
  resolveReturnUrl,
} from "@vxture/platform-browser";
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
import { accountsRequest } from "@/api/customer-self";
import type { OidcLoginResult } from "@/api/oidc";
import { useHumanCaptcha } from "./HumanCaptcha";
import { CustomerMfaChallenge } from "./CustomerMfaPanel";
import { OperatorMfaFlow } from "./OperatorMfaFlow";
import { SocialLoginButtons } from "./SocialLoginButtons";

const WEBSITE_HOME_URL = process.env.NEXT_PUBLIC_WEBSITE_URL ?? "";

type Realm = "customer" | "workforce";
type ResumeState =
  | { key: string; phase: "checking" | "ready" | "redirecting" }
  | { key: string; phase: "error"; message: string; retryable: boolean };

interface OidcLoginFormProps {
  readonly loginChallenge: string;
  readonly realm: Realm;
  readonly standalone?: boolean;
}

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Smart-detect the verification-code channel from the identifier (D-CC). */
function detectCodeChannel(value: string): "phone" | "email" | null {
  const trimmed = value.trim();
  if (PHONE_RE.test(trimmed)) return "phone";
  if (EMAIL_RE.test(trimmed)) return "email";
  return null;
}

export function OidcLoginForm({
  loginChallenge,
  realm,
  standalone,
}: OidcLoginFormProps) {
  const formText = useTranslations("accountsForms");
  const isOperator = realm === "workforce";
  const resumeKey = `${realm}:${loginChallenge}`;
  const [resumeState, setResumeState] = useState<ResumeState>({
    key: resumeKey,
    phase: "checking",
  });
  const [resumeRetry, setResumeRetry] = useState(0);
  const resolvedResumeKey = useRef<string | null>(null);
  const navigatingResumeKey = useRef<string | null>(null);
  const captcha = useHumanCaptcha(realm, true);
  // Workforce phone verification uses its isolated provider scheme.
  const [mode, setMode] = useState<AuthLoginTab>("phone");
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
  const [sentCodeTarget, setSentCodeTarget] = useState("");
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
    rememberRpOrigin(realm);
  }, [realm]);

  // Cross-tab session detection: when the user logs in via another RP while this
  // login page is open, the vx_sid cookie appears on accounts.vxture.com. On
  // tab-focus or visibility-restored, probe the resume endpoint; if the central
  // session can satisfy the parked challenge, navigate without re-authenticating.
  const loadingRef = useRef(false);
  const resumeRequest = useRef<{
    key: string;
    promise: ReturnType<typeof resumeOidcLogin>;
  } | null>(null);
  useEffect(() => {
    loadingRef.current = loading || sending || mfaChallenge !== null;
  }, [loading, sending, mfaChallenge]);

  useEffect(() => {
    if (mfaChallenge) return;
    let cancelled = false;
    let inFlight = false;
    let lastProbeAt = 0;

    const check = async () => {
      if (
        loadingRef.current ||
        navigatingResumeKey.current === resumeKey ||
        cancelled ||
        inFlight ||
        document.visibilityState !== "visible" ||
        Date.now() - lastProbeAt < 1500
      )
        return;
      inFlight = true;
      lastProbeAt = Date.now();
      const initialCheck = resolvedResumeKey.current !== resumeKey;
      if (initialCheck) setResumeState({ key: resumeKey, phase: "checking" });
      try {
        // Reuse the in-flight request across Strict Mode's effect replay: resume
        // can consume a one-time challenge and must not be sent twice.
        if (resumeRequest.current?.key !== resumeKey) {
          resumeRequest.current = {
            key: resumeKey,
            promise: resumeOidcLogin(loginChallenge),
          };
        }
        const request = resumeRequest.current;
        const result = await request.promise;
        if (cancelled) return;
        if (result) {
          navigatingResumeKey.current = resumeKey;
          setResumeState({ key: resumeKey, phase: "redirecting" });
          window.location.replace(result.redirectTo);
        } else {
          resolvedResumeKey.current = resumeKey;
          setResumeState({ key: resumeKey, phase: "ready" });
        }
      } catch (error) {
        // A background outage must not erase a form that is already usable.
        if (!cancelled && initialCheck) {
          setResumeState({
            key: resumeKey,
            phase: "error",
            message: error instanceof Error ? error.message : "",
            retryable: !(error instanceof SessionExpiredError),
          });
        }
      } finally {
        if (!cancelled) resumeRequest.current = null;
        inFlight = false;
      }
    };

    const handleFocus = () => void check();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    const interval = window.setInterval(handleFocus, 300_000);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loginChallenge, resumeKey, mfaChallenge, resumeRetry]);

  const switchMode = (m: AuthLoginTab) => {
    setMode(m);
    setErrors({});
    captcha.reset();
  };

  // Common gates shared by both submit paths.
  const commonError = (): string | null => {
    if (!acceptedTerms)
      return formText("please_accept_the_terms_and_privacy_policy");
    return null;
  };

  // The parked login_challenge is gone — there is nothing to retry inline,
  // send the user back to wherever they actually came from. Operators only go
  // back to an operator app; with none known they are told to restart there —
  // never sent to the tenant side (website / console).
  const redirectToReturnUrl = () => {
    if (standalone) {
      window.location.assign(isOperator ? "/workforce/login" : "/login");
      return;
    }
    if (isOperator) {
      const origin = resolveRealmReturnOrigin("workforce");
      if (origin) {
        window.location.assign(origin);
        return;
      }
      setErrors({ form: new SessionExpiredError().message });
      setLoading(false);
      return;
    }
    window.location.assign(resolveReturnUrl(WEBSITE_HOME_URL));
  };

  const handlePasswordSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!identifier.trim()) next.identifier = formText("enter_your_account");
    if (!password) next.password = formText("enter_your_password");
    const c = commonError();
    if (c) next.form = c;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const proof = await captcha.verify();
    if (proof === null) return;
    setLoading(true);
    try {
      const result = await completeOidcLogin({
        loginChallenge,
        identifier: identifier.trim(),
        password,
        ...(proof ? { captchaToken: proof } : {}),
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
        form:
          error instanceof Error
            ? error.message
            : formText("unable_to_sign_in_please_try_again"),
      });
      captcha.reset();
      setLoading(false);
    }
  };

  // Every send attempt spends its local human-verification proof.
  const doSendCode = async (proof: string) => {
    const channel = detectCodeChannel(codeId);
    if (!channel) return;

    setSending(true);
    try {
      if (isOperator) {
        await accountsRequest("/oidc/accounts/workforce/send-code", {
          method: "POST",
          body: JSON.stringify({
            login_challenge: loginChallenge,
            phone: codeId.trim(),
            captcha_token: proof,
          }),
        });
      } else if (channel === "phone") {
        await sendPhoneCode(codeId.trim(), proof);
      } else {
        await sendEmailCode(codeId.trim(), proof);
      }
      setCountdown(60);
      setSentCodeTarget(codeId.trim());
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

  const handleSendCode = async () => {
    if (sending || countdown > 0 || captcha.verifying) return;
    const next: Record<string, string> = {};
    const channel = detectCodeChannel(codeId);
    if (!channel || (isOperator && channel !== "phone"))
      next.phone = isOperator
        ? formText("enter_a_valid_phone_number")
        : formText("enter_a_valid_phone_number_or_email");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const proof = await captcha.verify();
    if (proof === null) return;
    await doSendCode(proof);
  };

  const handleCodeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const channel = detectCodeChannel(codeId);
    if (!channel || (isOperator && channel !== "phone"))
      next.phone = isOperator
        ? formText("enter_a_valid_phone_number")
        : formText("enter_a_valid_phone_number_or_email");
    if (code.trim().length !== 6)
      next.code = formText("enter_the_6_digit_code");
    if (!sentCodeTarget || sentCodeTarget !== codeId.trim())
      next.form = formText("request_a_verification_code_first");
    if (!acceptedTerms)
      next.form = formText("please_accept_the_terms_and_privacy_policy");
    setErrors(next);
    if (Object.keys(next).length > 0 || !channel) return;

    setLoading(true);
    try {
      const result = isOperator
        ? await accountsRequest<OidcLoginResult>(
            "/oidc/authorize/login/workforce-phone",
            {
              method: "POST",
              body: JSON.stringify({
                login_challenge: loginChallenge,
                phone: codeId.trim(),
                code: code.trim(),
              }),
            },
          )
        : channel === "phone"
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
      if ("status" in result) {
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
        form:
          error instanceof Error
            ? error.message
            : formText("unable_to_sign_in_please_try_again"),
      });
      setLoading(false);
    }
  };

  // Operator second-factor continuation replaces the login form entirely.
  if (mfaChallenge) {
    if (!isOperator)
      return <CustomerMfaChallenge token={mfaChallenge.mfaToken} />;
    return (
      <OperatorMfaFlow
        mfaToken={mfaChallenge.mfaToken}
        methods={mfaChallenge.methods}
        enrollRequired={mfaChallenge.enrollRequired}
        enrollFactor={mfaChallenge.enrollFactor}
      />
    );
  }

  // Keep the existing state-page composition until session restoration is resolved.
  if (
    resumeState.key !== resumeKey ||
    resumeState.phase === "checking" ||
    resumeState.phase === "redirecting"
  ) {
    return (
      <AccountsNotice
        tone="neutral"
        title={
          <span role="status" aria-live="polite">
            {formText("checking_sign_in_context")}
          </span>
        }
        description={formText("please_wait")}
      />
    );
  }
  if (resumeState.phase === "error") {
    return (
      <AccountsNotice
        title={formText("unable_to_confirm_sign_in_status")}
        description={
          resumeState.message || formText("unable_to_check_please_try_again")
        }
        action={
          <Button
            size="action"
            variant="secondary"
            onClick={() => {
              if (resumeState.retryable) setResumeRetry((value) => value + 1);
              else
                window.location.assign(
                  isOperator ? "/workforce/login" : "/login",
                );
            }}
          >
            {formText(resumeState.retryable ? "retry" : "sign_in_again")}
          </Button>
        }
      />
    );
  }

  // Both entry points share stable code/password tab geometry.
  const tabsNode = (
    <AuthTabs active={mode} onChange={switchMode} order={["phone", "login"]} />
  );

  // Social login is tenant-only (operator has no third-party login). The buttons
  // self-hide when no provider is enabled (table-driven).
  const socialNode = isOperator ? undefined : (
    <SocialLoginButtons loginChallenge={loginChallenge} />
  );

  const codeCanSubmit =
    sentCodeTarget === codeId.trim() &&
    Boolean(sentCodeTarget) &&
    Boolean(detectCodeChannel(codeId)) &&
    code.trim().length === 6 &&
    acceptedTerms;
  const passwordCanSubmit =
    identifier.trim().length > 0 &&
    password.length > 0 &&
    acceptedTerms &&
    captcha.available;

  return (
    <div
      className={
        isOperator
          ? "accounts-login-page accounts-workforce-page"
          : "accounts-login-page"
      }
    >
      <AuthLoginTemplate
        header={<AccountsAuthHeader />}
        footer={<AccountsAuthFooter />}
        title={
          isOperator
            ? formText("platform_operations")
            : formText("sign_in_to_vxture")
        }
        visual={ACCOUNTS_AUTH_VISUAL}
        useLoginLayout
      >
        {mode === "phone" ? (
          <AuthPhoneLoginPanel
            tabs={tabsNode}
            phone={codeId}
            code={code}
            agreementChecked={acceptedTerms}
            errors={errors}
            loading={loading}
            codeCountdown={countdown}
            sendCodeDisabled={countdown > 0 || sending || !captcha.available}
            sendingCodeLabel={
              captcha.verifying
                ? formText("security_verifying")
                : formText("sending")
            }
            codeSending={sending || captcha.verifying}
            verification={captcha.node}
            showForgot={false}
            submitLabel={
              isOperator ? formText("continue") : formText("sign_in_register")
            }
            primaryDisabled={!codeCanSubmit}
            phoneLabel={
              isOperator ? formText("phone") : formText("phone_email")
            }
            phonePlaceholder={
              isOperator
                ? formText("enter_your_phone_number")
                : formText("enter_your_phone_number_or_email")
            }
            phoneInputType="text"
            phoneIcon="user"
            phoneAutoComplete="username"
            options={{ showRemember: false }}
            onChangePhone={(value) => {
              setCodeId(value);
              setCode("");
              setSentCodeTarget("");
            }}
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
            loading={loading || captcha.verifying}
            submitLoadingLabel={
              captcha.verifying
                ? formText("security_verifying")
                : formText("signing_in")
            }
            verification={captcha.node}
            showForgot={!isOperator}
            primaryDisabled={!passwordCanSubmit}
            // 标签与占位符要说同一件事：面板缺省标签是"邮箱"，而这里接受的是
            // 账号/手机号/邮箱三种——标签写"账号"，具体形态由占位符举例。
            identifierLabel={
              isOperator ? formText("operator_account") : formText("account")
            }
            identifierPlaceholder={
              isOperator
                ? formText("enter_your_operator_account")
                : formText("email_account_phone")
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
        {socialNode ? (
          <div className="accounts-login-social">{socialNode}</div>
        ) : null}
      </AuthLoginTemplate>
    </div>
  );
}
