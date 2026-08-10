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
const OIDC_API_BASE =
  process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";

/**
 * The parked login_challenge is gone (expired / already consumed / never
 * existed). Distinct from a wrong-credential 401 — the caller should send the
 * user back to the originating app rather than show an inline retry error.
 */
export class SessionExpiredError extends Error {
  constructor() {
    super("登录会话已失效，请从应用重新发起登录");
    this.name = "SessionExpiredError";
  }
}

export interface CompleteOidcLoginInput {
  loginChallenge: string;
  identifier: string;
  password: string;
  /** Cloudflare Turnstile token (verified for both tenant and operator realms). */
  turnstileToken?: string;
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
    res = await fetch(`${OIDC_API_BASE}/oidc/authorize/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        login_challenge: input.loginChallenge,
        identifier: input.identifier,
        password: input.password,
        ...(input.turnstileToken
          ? { turnstile_token: input.turnstileToken }
          : {}),
      }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }

  if (!res.ok) {
    if (res.status === 401) throw new Error("账号或密码错误");
    if (res.status === 400) throw new SessionExpiredError();
    throw new Error("登录失败，请稍后重试");
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
  if (!data.redirectTo) throw new Error("登录响应异常，请重试");
  return { redirectTo: data.redirectTo };
}

/** Map an MFA endpoint failure to a user-facing message (shared by the steps). */
async function mfaError(res: Response): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  const message = data.message ?? "";
  if (res.status === 401) {
    if (message.includes("locked")) {
      return new Error("尝试次数过多，请重新登录");
    }
    return new Error("验证码错误，请重试");
  }
  if (res.status === 400) {
    return new Error("验证会话已失效，请重新登录");
  }
  return new Error("验证失败，请稍后重试");
}

/** POST /oidc/authorize/mfa/verify (totp | recovery) → { redirectTo }. */
export async function verifyOperatorMfa(
  mfaToken: string,
  method: "totp" | "recovery",
  code: string,
): Promise<{ redirectTo: string }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/authorize/mfa/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ mfa_token: mfaToken, method, code }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) throw await mfaError(res);
  const data = (await res.json().catch(() => ({}))) as { redirectTo?: string };
  if (!data.redirectTo) throw new Error("验证响应异常，请重试");
  return { redirectTo: data.redirectTo };
}

/** POST /oidc/authorize/mfa/enroll/totp → { secret, otpauthUri } (QR material). */
export async function beginOperatorTotpEnroll(
  mfaToken: string,
): Promise<{ secret: string; otpauthUri: string }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/authorize/mfa/enroll/totp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ mfa_token: mfaToken }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) throw await mfaError(res);
  const data = (await res.json().catch(() => ({}))) as {
    secret?: string;
    otpauthUri?: string;
  };
  if (!data.secret || !data.otpauthUri) {
    throw new Error("注册响应异常，请重试");
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
    res = await fetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/enroll/totp/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken, code }),
      },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) throw await mfaError(res);
  const data = (await res.json().catch(() => ({}))) as {
    redirectTo?: string;
    recoveryCodes?: string[];
  };
  if (!data.redirectTo) throw new Error("注册响应异常，请重试");
  return {
    redirectTo: data.redirectTo,
    recoveryCodes: data.recoveryCodes ?? [],
  };
}

/** Send an SMS login code (reuses the IdP's existing endpoint; gated by Turnstile). */
export async function sendPhoneCode(
  phone: string,
  turnstileToken: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/auth/send-phone-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, turnstile_token: turnstileToken }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 429) throw new Error("发送过于频繁，请稍后再试");
    throw new Error("验证码发送失败，请重试");
  }
}

/** Send an email login code (D-CC; gated by Turnstile, same as the SMS path). */
export async function sendEmailCode(
  email: string,
  turnstileToken: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/auth/send-email-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, turnstile_token: turnstileToken }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 429) throw new Error("发送过于频繁，请稍后再试");
    throw new Error("验证码发送失败，请重试");
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
    res = await fetch(`${OIDC_API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) throw new Error("提交失败，请稍后重试");
}

/** Consume a reset token and set the new password. 400 ⇒ link expired/used or password too weak. */
export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 400) {
      throw new Error("链接已失效或密码不符合要求，请重新申请重置");
    }
    throw new Error("重置失败，请稍后重试");
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
    res = await fetch(`${OIDC_API_BASE}/auth/operator/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (data.message === "weak_password") throw new Error("密码至少 12 位");
      throw new Error("链接无效或已过期，请联系管理员重新生成");
    }
    throw new Error("重置失败，请稍后重试");
  }
}

export interface EnabledProvider {
  code: string;
  name: string;
}

/** Enabled social providers (table-driven) for rendering the login buttons. */
export async function fetchEnabledProviders(): Promise<EnabledProvider[]> {
  try {
    const res = await fetch(`${OIDC_API_BASE}/auth/oauth/providers`, {
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
 * GET /oidc/authorize/resume — cross-tab session detection. Called by the
 * accounts login page on visibilitychange/focus to check whether a central
 * session (vx_sid) has appeared (e.g. user logged in via another RP). Returns
 * { redirectTo } when the challenge can be completed immediately, null otherwise.
 */
export async function resumeOidcLogin(
  loginChallenge: string,
): Promise<{ redirectTo: string } | null> {
  try {
    const res = await fetch(
      `${OIDC_API_BASE}/oidc/authorize/resume?login_challenge=${encodeURIComponent(loginChallenge)}`,
      { credentials: "include" },
    );
    if (res.status === 204 || !res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as {
      redirectTo?: string;
    };
    return data.redirectTo ? { redirectTo: data.redirectTo } : null;
  } catch {
    return null;
  }
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
    res = await fetch(`${OIDC_API_BASE}/auth/oauth/bind-phone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ binding_token: bindingToken, phone, code }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("验证码错误或已过期");
    if (res.status === 400) throw new Error("绑定会话已失效，请重新登录");
    throw new Error("绑定失败，请稍后重试");
  }
  const data = (await res.json().catch(() => ({}))) as { redirectTo?: string };
  if (!data.redirectTo) throw new Error("绑定响应异常，请重试");
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
): Promise<{ redirectTo: string }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/authorize/login/phone`, {
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
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("验证码错误或已过期");
    if (res.status === 400) throw new SessionExpiredError();
    throw new Error("登录失败，请稍后重试");
  }
  const data = (await res.json().catch(() => ({}))) as { redirectTo?: string };
  if (!data.redirectTo) throw new Error("登录响应异常，请重试");
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
): Promise<{ redirectTo: string }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/authorize/login/email`, {
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
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("验证码错误或已过期");
    if (res.status === 404) {
      throw new Error("该邮箱未注册，请先用手机号注册后在账号中心绑定邮箱");
    }
    if (res.status === 400) throw new SessionExpiredError();
    throw new Error("登录失败，请稍后重试");
  }
  const data = (await res.json().catch(() => ({}))) as { redirectTo?: string };
  if (!data.redirectTo) throw new Error("登录响应异常，请重试");
  return { redirectTo: data.redirectTo };
}
