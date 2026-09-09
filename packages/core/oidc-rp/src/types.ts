/**
 * types.ts - OIDC RP toolkit contracts
 * @package @vxture/core-oidc-rp
 * @description
 *   Shapes for the RP session model (identity-platform-rp-integration.md §3) and the
 *   OidcRpClient abstraction. The concrete client (hand-rolled fetch+JWKS vs
 *   openid-client) is intentionally pluggable behind OidcRpClient so the RP
 *   session/middleware layer is decided independently. See identity-platform-rp-integration.md.
 */

/** Per-RP OIDC client configuration (one per BFF). */
export interface OidcRpConfig {
  /** IdP issuer origin (e.g. https://auth.vxture.com). Used for the id_token `iss`
   * check and the browser-facing authorize/end_session URLs (public). */
  issuer: string;
  /** Optional internal origin for back-channel calls (token + JWKS), e.g.
   * http://vx-auth-bff:3090. Server-to-server traffic stays inside the cluster
   * instead of hairpinning out to the public issuer (Cloudflare), which is
   * unreliable from the origin. Defaults to `issuer` when unset. The id_token
   * `iss` is still verified against `issuer`. */
  backchannelIssuer?: string | undefined;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** requested scopes, e.g. ["openid","profile","console"] */
  scopes: string[];
  /** RP session TTL seconds (aligns with refresh lifetime) */
  sessionTtlSec: number;
}

/** OIDC token set held server-side by the RP-BFF (never sent to the browser). */
export interface OidcTokenSet {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** epoch seconds when the access token expires */
  accessExpiresAt: number;
}

/**
 * RP session record stored server-side (Redis), keyed by an opaque rpsid that
 * lives in the browser's __Host-vx_rp_session cookie. Tokens never reach the
 * browser. See identity-platform-rp-integration.md §3.
 */
export interface RpSession extends OidcTokenSet {
  /** central IdP session id (the token `sid` claim) — for back-channel logout */
  sid: string;
  /** subject (usr_<id> / opr_<id>) */
  sub: string;
  /** active organization carried by the access token (tenant realm) */
  activeOrg?: string | null;
}

/**
 * Caller identity mapped from a verified access token (Identity Platform §6.3:
 * sub + active_org + active_workspace + roles). The canonical shape RP BFFs use.
 */
export interface RpUser {
  /** identity-core user id (sub without the usr_/opr_ prefix). */
  userId: string;
  /** raw sub (usr_<id> / opr_<id>). */
  sub: string;
  /** active organization id, if present. */
  activeOrg: string | null;
  /** active organization type ("personal" | "organization") — personal-vs-team discriminator; null when not released. */
  activeOrgType: string | null;
  /** active organization display name; null when not released. */
  activeOrgName: string | null;
  /** active workspace id (default workspace), if present. */
  activeWorkspace: string | null;
  /** active workspace display name; null when not released. */
  activeWorkspaceName: string | null;
  /** governance role codes, scope-prefixed (e.g. org:owner, workspace:member). */
  roles: string[];
  /** realm marker: tenant_user | operator. */
  userType: string | null;
  /** display name (profile scope); null when not released. */
  name: string | null;
  /** login handle / preferred_username (profile scope); null when not released. */
  preferredUsername: string | null;
  /** email, if released; null otherwise. */
  email: string | null;
  /** whether the email is asserted verified; null when no email claim. */
  emailVerified: boolean | null;
  /** phone (strong anchor), if released; null otherwise. */
  phone: string | null;
  /** whether the phone is asserted verified; null when no phone claim. */
  phoneVerified: boolean | null;
  /** account lifecycle status (active|suspended|…); null when not released. */
  accountStatus: string | null;
  /** avatar URL (versioned); null when the user has no custom avatar (use default). */
  picture: string | null;
}

/** Verified id_token claims the RP relies on to establish a login. */
export interface OidcIdClaims {
  sub: string;
  sid: string;
  aud: string;
  iss: string;
  exp: number;
  nonce?: string | undefined;
  authTime?: number | undefined;
  userType?: string | undefined;
}

/** Parameters captured at /auth/login start, replayed at /auth/callback. */
export interface OidcAuthRequest {
  state: string;
  nonce: string;
  codeVerifier: string;
  /** post-login return target (origin-checked) */
  returnTo: string;
}

/**
 * Pluggable OIDC client. The RP session/middleware layer depends only on this;
 * the concrete implementation (hand-rolled fetch+JWKS or openid-client) is
 * chosen separately and injected. All token material stays server-side.
 */
export interface OidcRpClient {
  /** Build the IdP /authorize URL for a login (PKCE S256 + state + nonce). */
  buildAuthorizeUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    /** optional prompt (e.g. "none" for silent re-auth) */
    prompt?: string;
    /** optional tenant_hint for tenant switching */
    tenantHint?: string;
    /**
     * optional workspace_hint for workspace switching(owner 2026-09-09)。
     *
     * 与 tenantHint 形状对称、作用域独立:在 console 切工作空间不该动别的应用。
     * IdP 侧站不住会静默退回默认——提示过期是常态,不该让登录失败。
     */
    workspaceHint?: string | undefined;
  }): string;

  /** Exchange an authorization code (+ PKCE verifier) for a token set. */
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<OidcTokenSet>;

  /** Refresh an access token using a refresh token (rotation-aware). */
  refresh(refreshToken: string): Promise<OidcTokenSet>;

  /** Verify an IdP-issued id_token via JWKS (alg allowlist, iss/aud/nonce). */
  verifyIdToken(idToken: string, expectedNonce?: string): Promise<OidcIdClaims>;

  /**
   * Verify an IdP-issued access_token via JWKS (per-request, design §6) and
   * return its claims. Throws on bad signature / expiry / iss / aud.
   */
  verifyAccessToken(accessToken: string): Promise<Record<string, unknown>>;

  /**
   * Verify an IdP back-channel logout_token (RS256/JWKS, aud, backchannel-logout
   * event, sid, no nonce). Returns the central-session sid for destroyBySid.
   */
  verifyLogoutToken(
    logoutToken: string,
  ): Promise<{ sid: string; sub?: string }>;

  /** End the IdP central session (global logout); returns the redirect URL. */
  buildEndSessionUrl(input: {
    idTokenHint?: string;
    postLogoutRedirectUri: string;
    state?: string;
  }): string;
}
