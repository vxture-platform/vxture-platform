/**
 * oidc.ts - accounts → IdP login API
 * @package @vxture/accounts
 *
 * Completes a parked OIDC login_challenge by POSTing credentials to the IdP's
 * interactive-login endpoint. In prod the accounts surface is same-origin with
 * the OIDC API (accounts.vxture.com), so this is a same-origin request; in dev
 * it targets the auth-bff directly. The IdP sets the central-session cookie and
 * returns the RP redirect carrying the authorization code.
 */
import { accountsFetch } from "@/lib/http";
import { apiMessage } from "@/lib/api-message";
const OIDC_API_BASE =
  process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";

/**
 * The parked login_challenge is gone (expired / already consumed / never
 * existed). Distinct from a wrong-credential 401 — the caller should send the
 * user back to the originating app rather than show an inline retry error.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super(apiMessage("error_1"));
    this.name = "SessionExpiredError";
  }
}

/**
 * Read the realm from the server-owned login challenge.
 * @param loginChallenge - Opaque authorization request.
 * @returns The validated customer or workforce realm.
 * @throws {SessionExpiredError} When the parked request is no longer valid.
 * @throws {Error} When the identity service is unreachable or returns invalid data.
 */
export async function fetchLoginContext(
  loginChallenge: string,
): Promise<{ realm: "customer" | "workforce" }> {
  let res: Response;
  try {
    res = await accountsFetch(
      `${OIDC_API_BASE}/oidc/authorize/login-context?login_challenge=${encodeURIComponent(loginChallenge)}`,
      { cache: "no-store", signal: AbortSignal.timeout(10000) },
    );
  } catch {
    throw new Error(apiMessage("error_2"));
  }
  if (res.status === 400) throw new SessionExpiredError();
  if (!res.ok) throw new Error(apiMessage("error_3"));
  const data: unknown = await res.json();
  if (
    data &&
    typeof data === "object" &&
    "realm" in data &&
    (data.realm === "customer" || data.realm === "workforce")
  ) {
    return { realm: data.realm };
  }
  throw new Error(apiMessage("error_4"));
}

export interface CompleteOidcLoginInput {
  loginChallenge: string;
  identifier: string;
  password: string;
  /** Single-use realm-scoped captcha proof (verified for both tenant and operator realms). */
  captchaToken?: string;
}

/** Operator second-factor continuation (identity-platform-operator.md §3.2). */
export interface OidcMfaRequired {
  status: "mfa_required";
  mfaToken: string;
  /** Registered factors usable now (e.g. ["totp"], ["webauthn"]); empty ⇒ enroll. */
  methods: string[];
  /** Required policy but nothing enrolled → run the enroll ceremony. */
  enrollRequired: boolean;
  /** Which factor the enroll ceremony registers (null when already enrolled). */
  enrollFactor: "totp" | "webauthn" | null;
}

/** A completed login, or an operator MFA continuation. */
export type OidcLoginResult = { redirectTo: string } | OidcMfaRequired;

/**
 * POST /oidc/authorize/login. Returns { redirectTo } for a completed login, or
 * an { status:"mfa_required", ... } continuation for an operator owing a second
 * factor. Throws a user-facing message on failure.
 */
export async function completeOidcLogin(
  input: CompleteOidcLoginInput,
): Promise<OidcLoginResult> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/oidc/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        login_challenge: input.loginChallenge,
        identifier: input.identifier,
        password: input.password,
        ...(input.captchaToken ? { captcha_token: input.captchaToken } : {}),
      }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }

  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { message?: string };
    if (error.message === "human_verification_failed")
      throw new Error(apiMessage("error_6"));
    if (error.message === "human_verification_unavailable")
      throw new Error(apiMessage("error_7"));
    if (res.status === 429) throw new Error(apiMessage("error_8"));
    if (res.status === 401) throw new Error(apiMessage("error_9"));
    if (res.status === 400) throw new SessionExpiredError();
    throw new Error(apiMessage("error_10"));
  }

  const data = (await res.json().catch(() => ({}))) as {
    redirectTo?: string;
    status?: string;
    mfaToken?: string;
    methods?: string[];
    enrollRequired?: boolean;
    enrollFactor?: "totp" | "webauthn" | null;
  };
  if (data.status === "mfa_required" && data.mfaToken) {
    return {
      status: "mfa_required",
      mfaToken: data.mfaToken,
      methods: data.methods ?? [],
      enrollRequired: data.enrollRequired ?? false,
      enrollFactor: data.enrollFactor ?? null,
    };
  }
  if (!("redirectTo" in data) || !data.redirectTo)
    throw new Error(apiMessage("error_11"));
  return { redirectTo: data.redirectTo };
}

/** Map an MFA endpoint failure to a user-facing message (shared by the steps). */
async function mfaError(res: Response): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  const message = data.message ?? "";
  if (res.status === 401) {
    if (message.includes("locked")) {
      return new Error(apiMessage("error_12"));
    }
    return new Error(apiMessage("error_13"));
  }
  if (res.status === 400) {
    return new Error(apiMessage("error_14"));
  }
  return new Error(apiMessage("error_15"));
}

/** POST /oidc/authorize/mfa/verify (totp | recovery) → { redirectTo }. */
export async function verifyOperatorMfa(
  mfaToken: string,
  method: "totp" | "recovery",
  code: string,
): Promise<{ redirectTo: string }> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/oidc/authorize/mfa/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ mfa_token: mfaToken, method, code }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) throw await mfaError(res);
  const data = (await res.json().catch(() => ({}))) as { redirectTo?: string };
  if (!data.redirectTo) throw new Error(apiMessage("error_16"));
  return { redirectTo: data.redirectTo };
}

/** POST /oidc/authorize/mfa/enroll/totp → { secret, otpauthUri } (QR material). */
export async function beginOperatorTotpEnroll(
  mfaToken: string,
): Promise<{ secret: string; otpauthUri: string }> {
  let res: Response;
  try {
    res = await accountsFetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/enroll/totp`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken }),
      },
    );
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) throw await mfaError(res);
  const data = (await res.json().catch(() => ({}))) as {
    secret?: string;
    otpauthUri?: string;
  };
  if (!data.secret || !data.otpauthUri) {
    throw new Error(apiMessage("error_17"));
  }
  return { secret: data.secret, otpauthUri: data.otpauthUri };
}

/** POST /oidc/authorize/mfa/enroll/totp/confirm → { redirectTo, recoveryCodes }. */
export async function confirmOperatorTotpEnroll(
  mfaToken: string,
  code: string,
): Promise<{ redirectTo: string; recoveryCodes: string[] }> {
  let res: Response;
  try {
    res = await accountsFetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/enroll/totp/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken, code }),
      },
    );
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) throw await mfaError(res);
  const data = (await res.json().catch(() => ({}))) as {
    redirectTo?: string;
    recoveryCodes?: string[];
  };
  if (!data.redirectTo) throw new Error(apiMessage("error_17"));
  return {
    redirectTo: data.redirectTo,
    recoveryCodes: data.recoveryCodes ?? [],
  };
}

/** Send an SMS login code (reuses the IdP's existing endpoint; gated by human verification). */
export async function sendPhoneCode(
  phone: string,
  captchaToken: string,
): Promise<void> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/auth/send-phone-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, captcha_token: captchaToken }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { message?: string };
    if (error.message === "human_verification_failed")
      throw new Error(apiMessage("error_6"));
    if (res.status === 503) throw new Error(apiMessage("error_18"));
    if (res.status === 429) throw new Error(apiMessage("error_19"));
    throw new Error(apiMessage("error_20"));
  }
}

/** Send an SMS code bound to a pending social login. */
export async function sendBindPhoneCode(
  bindingToken: string,
  phone: string,
  captchaToken: string,
): Promise<void> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/auth/oauth/send-phone-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        binding_token: bindingToken,
        phone,
        captcha_token: captchaToken,
      }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { message?: string };
    if (error.message === "human_verification_failed")
      throw new Error(apiMessage("error_6"));
    if (res.status === 503) throw new Error(apiMessage("error_18"));
    if (res.status === 429) throw new Error(apiMessage("error_19"));
    throw new Error(apiMessage("error_20"));
  }
}

/** Send an email login code (D-CC; gated by human verification, same as the SMS path). */
export async function sendEmailCode(
  email: string,
  captchaToken: string,
): Promise<void> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/auth/send-email-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, captcha_token: captchaToken }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { message?: string };
    if (error.message === "human_verification_failed")
      throw new Error(apiMessage("error_6"));
    if (res.status === 503) throw new Error(apiMessage("error_18"));
    if (res.status === 429) throw new Error(apiMessage("error_19"));
    throw new Error(apiMessage("error_20"));
  }
}

/**
 * Request an email-link password reset (D-BE=A). The IdP always responds 200
 * (anti-enumeration), so there is nothing to branch on — the UI shows the same
 * "check your email" state regardless of whether the address is registered.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) throw new Error(apiMessage("error_21"));
}

/** Consume a reset token and set the new password. 400 ⇒ link expired/used or password too weak. */
export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) {
    if (res.status === 400) {
      throw new Error(apiMessage("error_22"));
    }
    throw new Error(apiMessage("error_23"));
  }
}

/**
 * Consume an admin-issued operator reset token and set the new password
 * (operator minimum is 12 chars, higher than the tenant surface). On success the
 * operator's sessions are revoked and they must re-login. 400 carries a code in
 * the NestJS `message` field — invalid_token / weak_password /
 * invalid_or_expired_token — mapped to a friendly, non-enumerating notice.
 */
export async function resetOperatorPassword(
  token: string,
  password: string,
): Promise<void> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/auth/operator/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) {
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (data.message === "weak_password")
        throw new Error(apiMessage("error_24"));
      throw new Error(apiMessage("error_25"));
    }
    throw new Error(apiMessage("error_23"));
  }
}

export interface EnabledProvider {
  code: string;
  name: string;
}

/** Enabled social providers (table-driven) for rendering the login buttons. */
export async function fetchEnabledProviders(): Promise<EnabledProvider[]> {
  try {
    const res = await accountsFetch(`${OIDC_API_BASE}/auth/oauth/providers`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { providers?: EnabledProvider[] };
    return data.providers ?? [];
  } catch {
    return [];
  }
}

/**
 * Resume the server-owned challenge using a central session.
 * @param loginChallenge - Realm-bound parked authorization request.
 * @returns A navigation target, or null only when the server confirms interactive login is needed.
 * @throws {SessionExpiredError} When the authorization request is invalid.
 * @throws {Error} When the bounded session check fails or returns malformed data.
 */
export async function resumeOidcLogin(
  loginChallenge: string,
): Promise<{ redirectTo: string } | null> {
  let response: Response;
  try {
    response = await accountsFetch(
      `${OIDC_API_BASE}/oidc/authorize/resume?login_challenge=${encodeURIComponent(loginChallenge)}`,
      {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      },
    );
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (response.status === 204) return null;
  if (response.status === 400) throw new SessionExpiredError();
  if (response.status === 429) throw new Error(apiMessage("error_8"));
  if (!response.ok) throw new Error(apiMessage("error_3"));
  const data: unknown = await response.json().catch(() => null);
  if (
    !data ||
    typeof data !== "object" ||
    !("redirectTo" in data) ||
    typeof data.redirectTo !== "string" ||
    !data.redirectTo.trim()
  ) {
    throw new Error(apiMessage("error_4"));
  }
  // The IdP may return a local account route or an HTTP(S) relying-party callback.
  try {
    const target = new URL(data.redirectTo, OIDC_API_BASE);
    if (!["https:", "http:"].includes(target.protocol))
      throw new Error("invalid_redirect");
  } catch {
    throw new Error(apiMessage("error_4"));
  }
  return { redirectTo: data.redirectTo };
}

/**
 * Absolute URL of the IdP social-login start endpoint. Top-level navigation here
 * 302s to the upstream provider; on return the IdP resolves the identity and
 * (via the parked login_challenge) completes the original OIDC authorize.
 */
export function buildSocialStartUrl(
  providerCode: string,
  loginChallenge: string,
): string {
  const u = new URL(`${OIDC_API_BASE}/auth/oauth/${providerCode}/start`);
  u.searchParams.set("login_challenge", loginChallenge);
  return u.toString();
}

/**
 * Complete a pending social→phone binding (no-phone upstreams, e.g. Google):
 * POST the binding token + phone + SMS code; returns the RP redirect to navigate to.
 */
export async function bindOAuthPhone(
  bindingToken: string,
  phone: string,
  code: string,
): Promise<{ redirectTo: string }> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/auth/oauth/bind-phone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ binding_token: bindingToken, phone, code }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error(apiMessage("error_26"));
    if (res.status === 400) throw new Error(apiMessage("error_27"));
    throw new Error(apiMessage("error_28"));
  }
  const data = (await res.json().catch(() => ({}))) as { redirectTo?: string };
  if (!data.redirectTo) throw new Error(apiMessage("error_29"));
  return { redirectTo: data.redirectTo };
}

export interface CompleteOidcPhoneLoginInput {
  loginChallenge: string;
  phone: string;
  code: string;
}

/** POST /oidc/authorize/login/phone → { redirectTo }. Tenant realm only. */
export async function completeOidcLoginWithPhone(
  input: CompleteOidcPhoneLoginInput,
): Promise<OidcLoginResult> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/oidc/authorize/login/phone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        login_challenge: input.loginChallenge,
        phone: input.phone,
        code: input.code,
      }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error(apiMessage("error_26"));
    if (res.status === 400) throw new SessionExpiredError();
    throw new Error(apiMessage("error_10"));
  }
  const data = (await res.json().catch(() => ({}))) as
    | { redirectTo?: string }
    | OidcMfaRequired;
  if ("status" in data && data.status === "mfa_required") return data;
  if (!("redirectTo" in data) || !data.redirectTo)
    throw new Error(apiMessage("error_11"));
  return { redirectTo: data.redirectTo };
}

export interface CompleteOidcEmailLoginInput {
  loginChallenge: string;
  email: string;
  code: string;
}

/**
 * POST /oidc/authorize/login/email → { redirectTo }. Tenant realm only,
 * login-only (D-CB): a 404 means the email maps to no account (register by
 * phone first), distinct from a 401 bad/expired code.
 */
export async function completeOidcLoginWithEmail(
  input: CompleteOidcEmailLoginInput,
): Promise<OidcLoginResult> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/oidc/authorize/login/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        login_challenge: input.loginChallenge,
        email: input.email,
        code: input.code,
      }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error(apiMessage("error_26"));
    if (res.status === 404) {
      throw new Error(apiMessage("error_30"));
    }
    if (res.status === 400) throw new SessionExpiredError();
    throw new Error(apiMessage("error_10"));
  }
  const data = (await res.json().catch(() => ({}))) as
    | { redirectTo?: string }
    | OidcMfaRequired;
  if ("status" in data && data.status === "mfa_required") return data;
  if (!("redirectTo" in data) || !data.redirectTo)
    throw new Error(apiMessage("error_11"));
  return { redirectTo: data.redirectTo };
}

// ─── 注册补齐（owner 2026-09-08）────────────────────────────────────────────

/**
 * 补齐页的会话没了（cookie 过期 / 被清 / 直接手打这个地址进来）。
 * 与"提交内容不合法"区分开：这一类要把人送回应用重新发起登录，重试没有意义。
 */
export class OnboardingSessionError extends Error {
  constructor() {
    super(apiMessage("error_1"));
    this.name = "OnboardingSessionError";
  }
}

export interface OnboardingState {
  phoneVerified: boolean;
  emailVerified: boolean;
  phone: string;
  account: string;
  displayName: string | null;
  email: string | null;
}

/** GET /oidc/onboarding —— 手机号（只读锚点）与已有的预填值。 */
export async function fetchOnboardingState(): Promise<OnboardingState> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/oidc/onboarding`, {
      credentials: "include",
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (res.status === 401) throw new OnboardingSessionError();
  if (!res.ok) throw new Error(apiMessage("error_31"));
  return (await res.json()) as OnboardingState;
}

/**
 * POST /oidc/onboarding —— 三项落库 + 标记完成 + 发授权码，一次返回回跳地址。
 * 409 的文案要能被调用方按字段分派，所以把后端的原因串原样带出去。
 */
export async function submitOnboarding(input: {
  account: string;
  displayName: string;
  email: string;
}): Promise<{ redirectTo: string }> {
  let res: Response;
  try {
    res = await accountsFetch(`${OIDC_API_BASE}/oidc/onboarding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        account: input.account,
        display_name: input.displayName,
        email: input.email,
      }),
    });
  } catch {
    throw new Error(apiMessage("error_5"));
  }
  if (res.status === 401) throw new OnboardingSessionError();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    // 409 的 message 形如 "username already in use" / "email already in use"。
    throw new Error(body.message ?? apiMessage("error_32"));
  }
  const data = (await res.json().catch(() => ({}))) as { redirectTo?: string };
  if (!data.redirectTo) throw new Error(apiMessage("error_33"));
  return { redirectTo: data.redirectTo };
}

/** Check a proposed platform account within the current onboarding session. */
export async function checkOnboardingAccount(
  account: string,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await accountsFetch(
    `${OIDC_API_BASE}/oidc/onboarding/account-availability?account=${encodeURIComponent(account)}`,
    {
      credentials: "include",
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) throw new Error(apiMessage("error_34"));
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("available" in data) ||
    typeof data.available !== "boolean"
  )
    throw new Error(apiMessage("error_35"));
  return data.available;
}
