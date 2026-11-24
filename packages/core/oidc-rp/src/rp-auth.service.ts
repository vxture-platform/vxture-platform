/**
 * Per-request RP authentication with fenced, distributed token rotation.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category auth
 * @author AI-Generated
 * @date 2026-11-24
 */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { OidcRpClient, RpSession } from "./types";
import type { RpSessionStore } from "./rp-session.store";
import {
  OidcTokenRequestError,
  type RpAuthUnavailable,
} from "./rp-auth.failure";

// ============================================================================
// Outcomes and storage boundary
// ============================================================================

export type RpAuthOutcome =
  | {
      status: "ok";
      rpsid: string;
      claims: Record<string, unknown>;
      refreshed: boolean;
      /** Verified token for server-side OBO only; never serialize to the browser. */
      accessToken: string;
    }
  | { status: "expired" }
  | RpAuthUnavailable;

/** Allows orchestration tests without emulating Redis Lua execution. */
export type RpAuthStore = Pick<
  RpSessionStore,
  "get" | "update" | "lockRefresh" | "unlockRefresh"
>;
type RefreshResult =
  | { status: "ready"; session: RpSession }
  | { status: "expired" }
  | RpAuthUnavailable;
const unavailable = (reauthorizationRequired = false): RpAuthUnavailable => ({
  status: "unavailable",
  reauthorizationRequired,
});

// ============================================================================
// Request verification
// ============================================================================

export class RpAuthService {
  private readonly inFlight = new Map<string, Promise<RefreshResult>>();

  constructor(
    private readonly store: RpAuthStore,
    private readonly client: OidcRpClient,
    private readonly sessionTtlSec: number,
    private readonly refreshSkewSec = 60,
  ) {}

  /**
   * Resolve a local session without treating availability failures as logout.
   * @param rpsid Opaque RP session identifier.
   * @returns Verified authorization, missing session, or an availability failure.
   */
  async resolve(rpsid: string | undefined): Promise<RpAuthOutcome> {
    if (!rpsid) return { status: "expired" };
    try {
      return await this.resolveSession(rpsid);
    } catch {
      return unavailable();
    }
  }

  private async resolveSession(rpsid: string): Promise<RpAuthOutcome> {
    let session = await this.store.get(rpsid);
    if (!session) return { status: "expired" };
    let refreshed = false;
    if (
      Math.floor(Date.now() / 1000) >=
      session.accessExpiresAt - this.refreshSkewSec
    ) {
      const next = await this.refreshOnce(rpsid, session);
      if (next.status !== "ready") return next;
      refreshed = next.session.accessToken !== session.accessToken;
      session = next.session;
    }
    if (
      !Number.isFinite(session.accessExpiresAt) ||
      session.accessExpiresAt <= Math.floor(Date.now() / 1000)
    )
      return unavailable();
    const claims = await this.client.verifyAccessToken(session.accessToken);
    if (
      claims.sub !== session.sub ||
      (claims.sid !== undefined && claims.sid !== session.sid)
    )
      return unavailable(true);
    // JWKS lookup may await a network round trip while logout commits elsewhere.
    const current = await this.store.get(rpsid);
    if (!current) return { status: "expired" };
    if (JSON.stringify(current) !== JSON.stringify(session))
      return unavailable();
    return {
      status: "ok",
      rpsid,
      claims,
      refreshed,
      accessToken: session.accessToken,
    };
  }

  // ========================================================================
  // Local single flight and distributed refresh lease
  // ========================================================================

  private refreshOnce(
    rpsid: string,
    session: RpSession,
  ): Promise<RefreshResult> {
    const existing = this.inFlight.get(rpsid);
    if (existing) return existing;
    const pending = this.doRefresh(rpsid, session).catch(() => unavailable());
    this.inFlight.set(rpsid, pending);
    void pending.then(() => {
      if (this.inFlight.get(rpsid) === pending) this.inFlight.delete(rpsid);
    });
    return pending;
  }

  private async doRefresh(
    rpsid: string,
    session: RpSession,
  ): Promise<RefreshResult> {
    const owner = randomUUID();
    // Bounded request-time lock contention; this is not a background status poll.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const current = await this.store.get(rpsid);
      if (!current) return { status: "expired" };
      if (JSON.stringify(current) !== JSON.stringify(session))
        return { status: "ready", session: current };
      if (!(await this.store.lockRefresh(rpsid, current, owner))) {
        await delay(25);
        continue;
      }
      try {
        return await this.rotate(rpsid, current, owner);
      } finally {
        await this.store.unlockRefresh(rpsid, owner);
      }
    }
    return unavailable();
  }

  private async rotate(
    rpsid: string,
    current: RpSession,
    owner: string,
  ): Promise<RefreshResult> {
    try {
      const next = await this.client.refresh(current.refreshToken);
      const identity = await this.client.verifyIdToken(next.idToken);
      const claims = await this.client.verifyAccessToken(next.accessToken);
      if (
        identity.sid !== current.sid ||
        identity.sub !== current.sub ||
        claims.sub !== current.sub ||
        (claims.sid !== undefined && claims.sid !== current.sid) ||
        !Number.isFinite(next.accessExpiresAt) ||
        next.accessExpiresAt <= Math.floor(Date.now() / 1000)
      )
        return unavailable(true);
      const updated: RpSession = {
        ...current,
        ...next,
        activeOrg:
          typeof claims.active_org === "string" ? claims.active_org : null,
      };
      if (
        await this.store.update(
          rpsid,
          updated,
          this.sessionTtlSec,
          current,
          owner,
        )
      )
        return { status: "ready", session: updated };
      const latest = await this.store.get(rpsid);
      return latest ? unavailable() : { status: "expired" };
    } catch (error) {
      const latest = await this.store.get(rpsid);
      if (!latest) return { status: "expired" };
      // A failed refresh does not invalidate a still-valid, verified access token.
      if (latest.accessExpiresAt > Math.floor(Date.now() / 1000))
        return { status: "ready", session: latest };
      return unavailable(
        error instanceof OidcTokenRequestError && error.reauthorizationRequired,
      );
    }
  }
}
