/**
 * http-client.ts - hand-rolled OIDC RP client (fetch + node:crypto JWKS verify)
 * @package @vxture/core-oidc-rp
 * @description
 *   Concrete OidcRpClient for the first-party Vxture IdP. Zero extra deps: uses
 *   the global fetch and pure node:crypto for RS256/JWKS verification
 *   (createPublicKey from JWK + crypto.verify) — controllable and CJS-bundle
 *   friendly (vs pulling an ESM-only OIDC lib into esbuild-bundled BFFs).
 *   See identity-platform-rp-integration.md §1/§5.
 */
import {
  createPublicKey,
  createVerify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import type {
  OidcIdClaims,
  OidcRpClient,
  OidcRpConfig,
  OidcTokenSet,
} from "./types";

type FetchImpl = typeof fetch;

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  [k: string]: unknown;
}

interface TokenResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Skew (seconds) tolerated on exp checks. */
const CLOCK_SKEW = 60;

export class HttpOidcRpClient implements OidcRpClient {
  private readonly fetchImpl: FetchImpl;
  private keysByKid = new Map<string, KeyObject>();

  constructor(
    private readonly config: OidcRpConfig,
    opts: { fetchImpl?: FetchImpl } = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ── back-channel base + JWKS ──────────────────────────────────────────────

  /** Origin for server-to-server calls (token + JWKS). Prefers the internal
   * backchannelIssuer so traffic never hairpins out to the public issuer. */
  private get backchannelBase(): string {
    return (this.config.backchannelIssuer ?? this.config.issuer).replace(
      /\/$/,
      "",
    );
  }

  /** Resolve a public key by kid, fetching+caching JWKS (one refresh on miss). */
  private async getKey(kid: string): Promise<KeyObject> {
    if (this.keysByKid.has(kid)) return this.keysByKid.get(kid)!;
    await this.refreshJwks();
    const key = this.keysByKid.get(kid);
    if (!key) throw new Error(`OIDC JWKS: no key for kid=${kid}`);
    return key;
  }

  private async refreshJwks(): Promise<void> {
    const jwks_uri = `${this.backchannelBase}/oidc/jwks`;
    const res = await this.fetchImpl(jwks_uri);
    if (!res.ok) throw new Error(`OIDC JWKS fetch failed: ${res.status}`);
    const { keys } = (await res.json()) as { keys: Jwk[] };
    const next = new Map<string, KeyObject>();
    for (const jwk of keys) {
      try {
        next.set(
          jwk.kid,
          createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" }),
        );
      } catch {
        // skip unusable key
      }
    }
    this.keysByKid = next;
  }

  // ── authorize / token / refresh ───────────────────────────────────────────

  buildAuthorizeUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    prompt?: string;
    tenantHint?: string;
    workspaceHint?: string;
  }): string {
    // Built synchronously from issuer + the standard path (avoids awaiting
    // discovery on the hot login path; our IdP path is stable).
    const base = `${this.config.issuer.replace(/\/$/, "")}/oidc/authorize`;
    const u = new URL(base);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.config.clientId);
    u.searchParams.set("redirect_uri", this.config.redirectUri);
    u.searchParams.set("scope", this.config.scopes.join(" "));
    u.searchParams.set("state", input.state);
    u.searchParams.set("nonce", input.nonce);
    u.searchParams.set("code_challenge", input.codeChallenge);
    u.searchParams.set("code_challenge_method", "S256");
    if (input.prompt) u.searchParams.set("prompt", input.prompt);
    if (input.tenantHint) u.searchParams.set("tenant_hint", input.tenantHint);
    if (input.workspaceHint)
      u.searchParams.set("workspace_hint", input.workspaceHint);
    return u.toString();
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<OidcTokenSet> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: this.config.redirectUri,
      code_verifier: input.codeVerifier,
    });
    return this.tokenRequest(body);
  }

  async refresh(refreshToken: string): Promise<OidcTokenSet> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return this.tokenRequest(body);
  }

  private async tokenRequest(body: URLSearchParams): Promise<OidcTokenSet> {
    const token_endpoint = `${this.backchannelBase}/oidc/token`;
    const basic = Buffer.from(
      `${encodeURIComponent(this.config.clientId)}:${encodeURIComponent(this.config.clientSecret)}`,
    ).toString("base64");
    const res = await this.fetchImpl(token_endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${basic}`,
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`OIDC token request failed: ${res.status}`);
    }
    const t = (await res.json()) as TokenResponse;
    return {
      idToken: t.id_token,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      accessExpiresAt: Math.floor(Date.now() / 1000) + (t.expires_in ?? 0),
    };
  }

  // ── verification ──────────────────────────────────────────────────────────

  async verifyIdToken(
    idToken: string,
    expectedNonce?: string,
  ): Promise<OidcIdClaims> {
    const claims = await this.verifyJws(idToken);
    if (claims.aud !== this.config.clientId) {
      throw new Error("OIDC id_token aud mismatch");
    }
    if (expectedNonce !== undefined && claims.nonce !== expectedNonce) {
      throw new Error("OIDC id_token nonce mismatch");
    }
    return {
      sub: String(claims.sub),
      sid: String(claims.sid ?? ""),
      aud: String(claims.aud),
      iss: String(claims.iss),
      exp: Number(claims.exp),
      nonce: claims.nonce as string | undefined,
      authTime: claims.auth_time as number | undefined,
      userType: claims.userType as string | undefined,
    };
  }

  async verifyAccessToken(
    accessToken: string,
  ): Promise<Record<string, unknown>> {
    const claims = await this.verifyJws(accessToken);
    if (claims.aud !== this.config.clientId) {
      throw new Error("OIDC access_token aud mismatch");
    }
    return claims;
  }

  /**
   * Verify an IdP back-channel logout_token (OpenID Back-Channel Logout 1.0
   * §2.4): RS256/JWKS + iss + exp (via verifyJws) + aud = this client, the
   * backchannel-logout event present, a `sid` (or `sub`), and NO `nonce`.
   * Returns the sid so the RP can `destroyBySid`. Replay is harmless
   * (destroyBySid is idempotent), so no jti store is needed.
   */
  async verifyLogoutToken(
    logoutToken: string,
  ): Promise<{ sid: string; sub?: string }> {
    const claims = await this.verifyJws(logoutToken);
    if (claims.aud !== this.config.clientId) {
      throw new Error("OIDC logout_token aud mismatch");
    }
    const events = claims.events;
    if (
      typeof events !== "object" ||
      events === null ||
      !("http://schemas.openid.net/event/backchannel-logout" in events)
    ) {
      throw new Error("OIDC logout_token: missing backchannel-logout event");
    }
    if (claims.nonce !== undefined) {
      throw new Error("OIDC logout_token: nonce must not be present");
    }
    const sid = typeof claims.sid === "string" ? claims.sid : "";
    if (!sid && claims.sub === undefined) {
      throw new Error("OIDC logout_token: must contain sid or sub");
    }
    const sub = claims.sub !== undefined ? String(claims.sub) : undefined;
    return { sid, ...(sub !== undefined ? { sub } : {}) };
  }

  /**
   * Verify a compact JWS (RS256) against the IdP JWKS and the issuer, returning
   * the decoded claims. Rejects alg downgrade (none/HS) and expired tokens.
   */
  private async verifyJws(token: string): Promise<Record<string, unknown>> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("OIDC token: malformed JWS");
    const [h, p, s] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as {
      alg?: string;
      kid?: string;
    };
    if (header.alg !== "RS256") {
      throw new Error(`OIDC token: unsupported alg ${header.alg}`);
    }
    if (!header.kid) throw new Error("OIDC token: missing kid");

    const key = await this.getKey(header.kid);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    verifier.end();
    if (!verifier.verify(key, Buffer.from(s, "base64url"))) {
      throw new Error("OIDC token: signature verification failed");
    }

    const claims = JSON.parse(
      Buffer.from(p, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (claims.iss !== this.config.issuer) {
      throw new Error("OIDC token: iss mismatch");
    }
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp === "number" && claims.exp + CLOCK_SKEW < now) {
      throw new Error("OIDC token: expired");
    }
    return claims;
  }

  buildEndSessionUrl(input: {
    idTokenHint?: string;
    postLogoutRedirectUri: string;
    state?: string;
  }): string {
    const base = `${this.config.issuer.replace(/\/$/, "")}/oidc/end_session`;
    const u = new URL(base);
    u.searchParams.set("post_logout_redirect_uri", input.postLogoutRedirectUri);
    if (input.idTokenHint)
      u.searchParams.set("id_token_hint", input.idTokenHint);
    if (input.state) u.searchParams.set("state", input.state);
    return u.toString();
  }
}
