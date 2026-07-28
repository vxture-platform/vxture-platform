/**
 * rp-auth.service.ts - per-request RP auth orchestration
 * @package @vxture/core-oidc-rp
 * @description
 *   Resolves an authenticated request from the opaque rpsid: loads the RP
 *   session, silently refreshes the access token when near expiry (rotation
 *   updates server-side state only — the rpsid cookie is stable), verifies the
 *   (possibly refreshed) access token via JWKS, and returns its claims. A
 *   missing session or a failed refresh yields "expired" so the BFF can route
 *   to re-login. Framework-light: the BFF middleware/guard wraps this.
 *   See identity-platform-rp-integration.md §6/§7.
 */
import type { OidcRpClient } from "./types";
import type { RpSessionStore } from "./rp-session.store";

/** Seconds before access-token expiry at which we proactively refresh. */
const DEFAULT_REFRESH_SKEW = 60;

export type RpAuthOutcome =
  | {
      status: "ok";
      rpsid: string;
      /** verified access-token claims (sub, userType, active_org, active_workspace, roles, …) */
      claims: Record<string, unknown>;
      /** true if the access token was refreshed on this request */
      refreshed: boolean;
      /**
       * The raw (verified) access token backing this session — needed when the
       * BFF must present it as an RFC 8693 subject_token (e.g. the operator-OBO
       * exchange of product_250 M-1). Server-side only; never send to the browser.
       */
      accessToken: string;
    }
  | { status: "expired" }; // no usable session / refresh failed → re-login

export class RpAuthService {
  constructor(
    private readonly store: RpSessionStore,
    private readonly client: OidcRpClient,
    private readonly sessionTtlSec: number,
    private readonly refreshSkewSec: number = DEFAULT_REFRESH_SKEW,
  ) {}

  /**
   * Resolve the authenticated context for a request bearing `rpsid`.
   * Returns "expired" when there is no session or the refresh fails (the BFF
   * then 401s an XHR or 302s a page navigation to /auth/login).
   */
  async resolve(rpsid: string | undefined): Promise<RpAuthOutcome> {
    if (!rpsid) return { status: "expired" };

    let session = await this.store.get(rpsid);
    if (!session) return { status: "expired" };

    let refreshed = false;
    const now = Math.floor(Date.now() / 1000);
    if (now >= session.accessExpiresAt - this.refreshSkewSec) {
      try {
        const next = await this.client.refresh(session.refreshToken);
        session = {
          ...session,
          idToken: next.idToken,
          accessToken: next.accessToken,
          refreshToken: next.refreshToken,
          accessExpiresAt: next.accessExpiresAt,
        };
        await this.store.update(rpsid, session, this.sessionTtlSec);
        refreshed = true;
      } catch {
        // refresh rejected (expired / revoked / reuse) → drop the session.
        await this.store.destroy(rpsid);
        return { status: "expired" };
      }
    }

    let claims: Record<string, unknown>;
    try {
      claims = await this.client.verifyAccessToken(session.accessToken);
    } catch {
      return { status: "expired" };
    }
    return {
      status: "ok",
      rpsid,
      claims,
      refreshed,
      accessToken: session.accessToken,
    };
  }
}
