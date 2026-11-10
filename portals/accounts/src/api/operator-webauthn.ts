/**
 * operator-webauthn.ts - operator passkey registration (accounts → IdP, P3.1).
 * @package @vxture/accounts
 *
 * Drives the WebAuthn registration ceremony for an authenticated operator: fetch
 * options from the IdP, run the browser ceremony (@simplewebauthn/browser), then
 * post the response back for verification + persistence. Same-origin with the
 * OIDC API on the accounts surface (operator central session cookie included).
 */
import { apiMessage } from "@/lib/api-message";
import { AccountSessionError } from "@/lib/account-session";
import { accountsFetch } from "@/lib/http";
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
    optRes = await accountsFetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/register/options`,
      { method: "POST", credentials: "include" },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!optRes.ok) {
    if (optRes.status === 401)
      throw new AccountSessionError(
        "workforce",
        apiMessage("operator_sign_in_required"),
      );
    if (optRes.status === 503)
      throw new Error(apiMessage("passkey_unavailable"));
    throw new Error(apiMessage("passkey_register_start_failed"));
  }
  const options =
    (await optRes.json()) as PublicKeyCredentialCreationOptionsJSON;

  // 2. Browser ceremony (navigator.credentials.create).
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch {
    throw new Error(apiMessage("passkey_register_cancelled"));
  }

  // 3. Verify + persist.
  let verRes: Response;
  try {
    verRes = await accountsFetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/register/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ response }),
      },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!verRes.ok) {
    if (verRes.status === 400)
      throw new Error(apiMessage("passkey_registration_expired"));
    if (verRes.status === 401)
      throw new AccountSessionError(
        "workforce",
        apiMessage("operator_sign_in_required"),
      );
    throw new Error(apiMessage("passkey_register_failed"));
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
    optRes = await accountsFetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/enroll/webauthn/options`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken }),
      },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!optRes.ok) {
    if (optRes.status === 400)
      throw new Error(apiMessage("passkey_registration_sign_in"));
    if (optRes.status === 503)
      throw new Error(apiMessage("passkey_unavailable"));
    throw new Error(apiMessage("passkey_register_retry"));
  }
  const options =
    (await optRes.json()) as PublicKeyCredentialCreationOptionsJSON;

  // 2. Browser ceremony.
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch {
    throw new Error(apiMessage("passkey_register_cancelled"));
  }

  // 3. Verify → complete login.
  let verRes: Response;
  try {
    verRes = await accountsFetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/enroll/webauthn/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken, response }),
      },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!verRes.ok) {
    if (verRes.status === 400)
      throw new Error(apiMessage("passkey_registration_sign_in"));
    throw new Error(apiMessage("passkey_register_failed"));
  }
  const data = (await verRes.json().catch(() => ({}))) as {
    redirectTo?: string;
  };
  if (!data.redirectTo)
    throw new Error(apiMessage("passkey_registration_response_invalid"));
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
    res = await accountsFetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/credentials`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!res.ok) {
    if (res.status === 401)
      throw new AccountSessionError(
        "workforce",
        apiMessage("operator_sign_in_required"),
      );
    throw new Error(apiMessage("passkey_list_failed"));
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
    res = await accountsFetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/credentials/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ label }),
      },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!res.ok) {
    if (res.status === 401)
      throw new AccountSessionError(
        "workforce",
        apiMessage("operator_sign_in_required"),
      );
    if (res.status === 404) throw new Error(apiMessage("passkey_not_found"));
    throw new Error(apiMessage("passkey_rename_failed"));
  }
}

/** Revoke a passkey (server blocks removing the last one for required operators). */
export async function revokeOperatorPasskey(id: string): Promise<void> {
  let res: Response;
  try {
    res = await accountsFetch(
      `${OIDC_API_BASE}/oidc/operator/webauthn/credentials/${encodeURIComponent(id)}`,
      { method: "DELETE", credentials: "include" },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status === 401)
      throw new AccountSessionError(
        "workforce",
        apiMessage("operator_sign_in_required"),
      );
    if (res.status === 404) throw new Error(apiMessage("passkey_not_found"));
    if (
      res.status === 400 &&
      (data.message ?? "").includes("last_webauthn_credential")
    ) {
      throw new Error(apiMessage("passkey_last_required"));
    }
    throw new Error(apiMessage("passkey_delete_failed"));
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
    optRes = await accountsFetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/webauthn/options`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken }),
      },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!optRes.ok) {
    if (optRes.status === 400)
      throw new Error(apiMessage("passkey_verification_expired"));
    throw new Error(apiMessage("passkey_auth_start_failed"));
  }
  const options =
    (await optRes.json()) as PublicKeyCredentialRequestOptionsJSON;

  // 2. Browser ceremony (navigator.credentials.get).
  let response;
  try {
    response = await startAuthentication({ optionsJSON: options });
  } catch {
    throw new Error(apiMessage("passkey_auth_cancelled"));
  }

  // 3. Verify → complete login.
  let verRes: Response;
  try {
    verRes = await accountsFetch(
      `${OIDC_API_BASE}/oidc/authorize/mfa/webauthn/verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mfa_token: mfaToken, response }),
      },
    );
  } catch {
    throw new Error(apiMessage("network_error"));
  }
  if (!verRes.ok) {
    if (verRes.status === 401)
      throw new Error(apiMessage("passkey_auth_failed"));
    if (verRes.status === 400)
      throw new Error(apiMessage("passkey_verification_expired"));
    throw new Error(apiMessage("passkey_auth_failed"));
  }
  const data = (await verRes.json().catch(() => ({}))) as {
    redirectTo?: string;
  };
  if (!data.redirectTo)
    throw new Error(apiMessage("passkey_auth_response_invalid"));
  return { redirectTo: data.redirectTo };
}
