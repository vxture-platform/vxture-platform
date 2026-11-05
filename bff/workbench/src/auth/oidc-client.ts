/**
 * Bounded OIDC transport and additional required-claim validation.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category auth
 * @author AI-Generated
 * @date 2026-11-05
 */
import { HttpOidcRpClient, type OidcIdClaims } from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: reuse platform RS256/JWKS verification and PKCE transport.
import type { WorkbenchConfig } from "../config";
import { failure } from "../errors";

// ============================================================================
// Required claims are checked after the shared client verifies the signature.
// ============================================================================
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * Reject malformed required claims after cryptographic verification.
 * @param claims - Cryptographically verified token payload.
 * @returns The validated payload.
 * @throws {HttpException} When required identity or time claims are invalid.
 */
export function validateClaims(
  claims: Record<string, unknown>,
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof claims.sub !== "string" ||
    !claims.sub.startsWith("usr_") ||
    !UUID.test(claims.sub.slice(4)) ||
    typeof claims.exp !== "number" ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= now ||
    (claims.nbf !== undefined &&
      (typeof claims.nbf !== "number" ||
        !Number.isFinite(claims.nbf) ||
        claims.nbf > now + 60)) ||
    (claims.iat !== undefined &&
      (typeof claims.iat !== "number" ||
        !Number.isFinite(claims.iat) ||
        claims.iat > now + 60))
  )
    throw failure(401, "WORKBENCH_TOKEN_INVALID", "Invalid identity token");
  return claims;
}

/**
 * Bind both verified token types to one customer subject and central session.
 * @param id - Verified ID token claims.
 * @param access - Verified access token claims.
 * @returns Nothing on a valid binding.
 * @throws {HttpException} When subjects, realm or context do not match.
 */
export function validateBinding(
  id: OidcIdClaims,
  access: Record<string, unknown>,
): void {
  validateContext(access);
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(id.sid) ||
    id.sub !== access.sub ||
    !Number.isFinite(id.exp) ||
    id.exp <= Math.floor(Date.now() / 1000) ||
    (access.sid !== undefined && access.sid !== id.sid)
  )
    throw failure(401, "WORKBENCH_TOKEN_INVALID", "Invalid token binding");
}

/**
 * Require a valid customer realm and workspace context on every request.
 * @param access - Verified access claims.
 * @returns Nothing for a valid customer context.
 * @throws {HttpException} When the account or context is invalid.
 */
export function validateContext(access: Record<string, unknown>): void {
  validateClaims(access);
  if (
    access.userType !== "tenant_user" ||
    access.account_status !== "active" ||
    typeof access.active_org !== "string" ||
    !UUID.test(access.active_org) ||
    typeof access.active_workspace !== "string" ||
    !UUID.test(access.active_workspace) ||
    !Array.isArray(access.roles) ||
    !access.roles.some(
      (r) => typeof r === "string" && r.startsWith("workspace:"),
    )
  )
    throw failure(
      401,
      "WORKBENCH_TOKEN_INVALID",
      "Invalid customer session context",
    );
}

/** Workbench-specific transport keeps every request inside the refresh lock lease. */
export class WorkbenchOidcClient extends HttpOidcRpClient {
  constructor(private readonly runtime: WorkbenchConfig) {
    super(runtime.oidc, {
      fetchImpl: (url, init) =>
        fetch(url, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        }),
    });
  }

  override async verifyIdToken(
    token: string,
    nonce?: string,
  ): Promise<OidcIdClaims> {
    const identity = await super.verifyIdToken(token, nonce);
    // The shared projection coerces exp; inspect the verified payload before use.
    const payload: unknown = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"),
    );
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw failure(401, "WORKBENCH_TOKEN_INVALID", "Invalid ID token payload");
    validateClaims(payload as Record<string, unknown>);
    return identity;
  }

  async centralStatus(
    sid: string,
  ): Promise<{ valid: false } | { valid: true; nextCheckAt: number }> {
    const cfg = this.runtime.oidc;
    const basic = Buffer.from(
      `${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`,
    ).toString("base64");
    const response = await fetch(
      `${cfg.backchannelIssuer ?? cfg.issuer}/oidc/session/status`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${basic}`,
        },
        // Passive reads never claim user activity or prolong central login.
        body: JSON.stringify({ sid, active: false }),
      },
    );
    if (!response.ok)
      throw failure(
        503,
        "WORKBENCH_IDP_UNAVAILABLE",
        "Session verification temporarily unavailable",
      );
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "valid" in body) {
      if (body.valid === false) return { valid: false };
      if (
        body.valid === true &&
        "next_check_at" in body &&
        typeof body.next_check_at === "number" &&
        Number.isInteger(body.next_check_at) &&
        body.next_check_at > Math.floor(Date.now() / 1000)
      )
        return {
          valid: true,
          nextCheckAt: Math.min(
            body.next_check_at,
            Math.floor(Date.now() / 1000) + 300,
          ),
        };
    }
    throw failure(
      503,
      "WORKBENCH_IDP_UNAVAILABLE",
      "Invalid session verification response",
    );
  }
}
