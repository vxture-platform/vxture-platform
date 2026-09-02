/**
 * operator-self.ts — operator self-service account (accounts → IdP, Phase B).
 * @package @vxture/accounts
 *
 * Reads the authenticated operator's own account and drives the email-change
 * ceremony. Same-origin with the OIDC API on the accounts surface, so the operator
 * central session cookie (vx_sid_op) is included; unauthenticated → 401 "请先登录".
 * Mirrors operator-webauthn.ts (same base, credentials:"include", 401 handling).
 */
const OIDC_API_BASE =
  process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";

/** The authenticated operator's own account view (no secret material). */
export interface OperatorSelf {
  username: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  role: string;
  mfaTotpEnabled: boolean;
}

/** A 401 from these endpoints means "no operator session" — callers show a login prompt. */
export class OperatorUnauthenticatedError extends Error {
  constructor() {
    super("operator_unauthenticated");
    this.name = "OperatorUnauthenticatedError";
  }
}

/** Read the authenticated operator's own account. 401 → OperatorUnauthenticatedError. */
export async function fetchOperatorSelf(): Promise<OperatorSelf> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/self`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new OperatorUnauthenticatedError();
    throw new Error("无法加载账户信息，请重试");
  }
  return (await res.json()) as OperatorSelf;
}

/** Email change step 1: send a 6-digit code to the new address. Returns the masked target. */
export async function startOperatorEmailChange(
  newEmail: string,
): Promise<{ sentTo: string }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/self/email/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ newEmail }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new OperatorUnauthenticatedError();
    if (res.status === 400) throw new Error("邮箱格式不正确");
    throw new Error("发送验证码失败，请重试");
  }
  return (await res.json()) as { sentTo: string };
}

/** Email change step 2: submit the code from the new address. Returns the new email. */
export async function verifyOperatorEmailChange(
  code: string,
): Promise<{ email: string }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/self/email/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new OperatorUnauthenticatedError();
    if (res.status === 409) throw new Error("该邮箱已被占用");
    if (res.status === 400) throw new Error("验证码错误或已过期");
    throw new Error("验证失败，请重试");
  }
  return (await res.json()) as { email: string };
}

/** Phone change step 1: send an SMS code to the new number. Returns the masked target. */
export async function startOperatorPhoneChange(
  newPhone: string,
): Promise<{ sentTo: string }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/self/phone/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ newPhone }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new OperatorUnauthenticatedError();
    if (res.status === 400) throw new Error("手机号格式不正确");
    throw new Error("发送验证码失败，请重试");
  }
  return (await res.json()) as { sentTo: string };
}

/** Phone change step 2: submit the code sent to the new number. Returns the new phone. */
export async function verifyOperatorPhoneChange(
  newPhone: string,
  code: string,
): Promise<{ phone: string }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/self/phone/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ newPhone, code }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new OperatorUnauthenticatedError();
    if (res.status === 409) throw new Error("该手机号已被占用");
    if (res.status === 400) throw new Error("验证码错误或已过期");
    throw new Error("验证失败，请重试");
  }
  return (await res.json()) as { phone: string };
}

/** Change password: verify current, set new (min 12). Other sessions are revoked. */
export async function changeOperatorPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/self/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new OperatorUnauthenticatedError();
    if (res.status === 400) {
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      const m = data.message ?? "";
      if (m.includes("invalid_current_password"))
        throw new Error("当前密码不正确");
      if (m.includes("weak_password")) throw new Error("新密码至少 12 位");
      throw new Error("修改失败，请检查输入");
    }
    throw new Error("修改密码失败，请重试");
  }
}

/** TOTP (re-)enroll step 1: stage a new secret. Returns base32 secret + otpauth URI (QR). */
export async function startOperatorMfaTotp(): Promise<{
  secret: string;
  otpauthUri: string;
}> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/self/mfa/totp/start`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new OperatorUnauthenticatedError();
    throw new Error("无法发起二次验证设置，请重试");
  }
  return (await res.json()) as { secret: string; otpauthUri: string };
}

/** TOTP (re-)enroll step 2: confirm the code → enable + one-time recovery codes. */
export async function confirmOperatorMfaTotp(
  code: string,
): Promise<{ recoveryCodes: string[] }> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/self/mfa/totp/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new OperatorUnauthenticatedError();
    if (res.status === 400) throw new Error("验证码错误或已过期");
    throw new Error("设置失败，请重试");
  }
  return (await res.json()) as { recoveryCodes: string[] };
}
