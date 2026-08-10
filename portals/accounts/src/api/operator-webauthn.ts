/**
 * operator-webauthn.ts - operator passkey registration (accounts → IdP, P3.1).
 * @package @vxture/accounts
 *
 * Drives the WebAuthn registration ceremony for an authenticated operator: fetch
 * options from the IdP, run the browser ceremony (@simplewebauthn/browser), then
 * post the response back for verification + persistence. Same-origin with the
 * OIDC API on the accounts surface (operator central session cookie included).
 */
import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

const OIDC_API_BASE =
  process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";

/**
 * Register a new operator passkey. Throws a user-facing message on failure
 * (including a user-cancelled/unsupported ceremony). Returns the new credential id.
 */
export async function registerOperatorPasskey(): Promise<{
  credentialId: string;
}> {
  // 1. Options (challenge parked server-side).
  let optRes: Response;
  try {
    optRes = await fetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/register/options`,
      { method: "POST", credentials: "include" },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!optRes.ok) {
    if (optRes.status === 401) throw new Error("请先登录运营账号");
    if (optRes.status === 503)
      throw new Error("通行密钥暂不可用，请联系管理员");
    throw new Error("无法发起通行密钥注册，请稍后重试");
  }
  const options =
    (await optRes.json()) as PublicKeyCredentialCreationOptionsJSON;

  // 2. Browser ceremony (navigator.credentials.create).
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch {
    throw new Error("通行密钥注册被取消或不受支持");
  }

  // 3. Verify + persist.
  let verRes: Response;
  try {
    verRes = await fetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/register/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ response }),
      },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!verRes.ok) {
    if (verRes.status === 400) throw new Error("注册会话已失效，请重试");
    if (verRes.status === 401) throw new Error("请先登录运营账号");
    throw new Error("通行密钥注册失败，请重试");
  }
  return (await verRes.json()) as { credentialId: string };
}

/**
 * Enroll-on-login: register the first passkey for a high-privilege operator who
 * is required to use WebAuthn but has none yet (Step2 bootstrap, P3.3). Bound to
 * the mfa_pending token; a verified registration completes the login. Returns
 * the RP redirect on success.
 */
export async function enrollOperatorPasskeyOnLogin(
  mfaToken: string,
): Promise<{ redirectTo: string }> {
  // 1. Registration options (challenge parked server-side).
  let optRes: Response;
  try {
    optRes = await fetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/enroll/webauthn/options`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken }),
      },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!optRes.ok) {
    if (optRes.status === 400) throw new Error("注册会话已失效，请重新登录");
    if (optRes.status === 503)
      throw new Error("通行密钥暂不可用，请联系管理员");
    throw new Error("无法发起通行密钥注册，请重试");
  }
  const options =
    (await optRes.json()) as PublicKeyCredentialCreationOptionsJSON;

  // 2. Browser ceremony.
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch {
    throw new Error("通行密钥注册被取消或不受支持");
  }

  // 3. Verify → complete login.
  let verRes: Response;
  try {
    verRes = await fetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/enroll/webauthn/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken, response }),
      },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!verRes.ok) {
    if (verRes.status === 400) throw new Error("注册会话已失效，请重新登录");
    throw new Error("通行密钥注册失败，请重试");
  }
  const data = (await verRes.json().catch(() => ({}))) as {
    redirectTo?: string;
  };
  if (!data.redirectTo) throw new Error("注册响应异常，请重试");
  return { redirectTo: data.redirectTo };
}

/** A registered operator passkey for the management UI (P3.4). */
export interface OperatorPasskey {
  id: string;
  label: string | null;
  aaguid: string | null;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** List the authenticated operator's passkeys. */
export async function listOperatorPasskeys(): Promise<OperatorPasskey[]> {
  let res: Response;
  try {
    res = await fetch(`${OIDC_API_BASE}/oidc/operator/webauthn/credentials`, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("请先登录运营账号");
    throw new Error("无法加载通行密钥列表，请重试");
  }
  const data = (await res.json().catch(() => ({}))) as {
    credentials?: OperatorPasskey[];
  };
  return data.credentials ?? [];
}

/** Rename a passkey. */
export async function renameOperatorPasskey(
  id: string,
  label: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/credentials/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label }),
      },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error("请先登录运营账号");
    if (res.status === 404) throw new Error("通行密钥不存在");
    throw new Error("重命名失败，请重试");
  }
}

/** Revoke a passkey (server blocks removing the last one for required operators). */
export async function revokeOperatorPasskey(id: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/credentials/${encodeURIComponent(id)}`,
      { method: "DELETE", credentials: "include" },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status === 401) throw new Error("请先登录运营账号");
    if (res.status === 404) throw new Error("通行密钥不存在");
    if (
      res.status === 400 &&
      (data.message ?? "").includes("last_webauthn_credential")
    ) {
      throw new Error("这是唯一的通行密钥，且账号要求通行密钥，无法删除");
    }
    throw new Error("删除失败，请重试");
  }
}

/**
 * Authenticate with a passkey as the second factor during login (Step2, P3.2).
 * Bound to the mfa_pending token. Returns the RP redirect on success; throws a
 * user-facing message on failure (cancelled/expired/clone-rejected).
 */
export async function authenticateOperatorPasskey(
  mfaToken: string,
): Promise<{ redirectTo: string }> {
  // 1. Options (challenge parked server-side).
  let optRes: Response;
  try {
    optRes = await fetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/webauthn/options`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken }),
      },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!optRes.ok) {
    if (optRes.status === 400) throw new Error("验证会话已失效，请重新登录");
    throw new Error("无法发起通行密钥验证，请重试");
  }
  const options =
    (await optRes.json()) as PublicKeyCredentialRequestOptionsJSON;

  // 2. Browser ceremony (navigator.credentials.get).
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch {
    throw new Error("通行密钥验证被取消或不受支持");
  }

  // 3. Verify → complete login.
  let verRes: Response;
  try {
    verRes = await fetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/webauthn/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken, response }),
      },
    );
  } catch {
    throw new Error("网络异常，请稍后重试");
  }
  if (!verRes.ok) {
    if (verRes.status === 401) throw new Error("通行密钥验证失败，请重试");
    if (verRes.status === 400) throw new Error("验证会话已失效，请重新登录");
    throw new Error("通行密钥验证失败，请重试");
  }
  const data = (await verRes.json().catch(() => ({}))) as {
    redirectTo?: string;
  };
  if (!data.redirectTo) throw new Error("验证响应异常，请重试");
  return { redirectTo: data.redirectTo };
}
