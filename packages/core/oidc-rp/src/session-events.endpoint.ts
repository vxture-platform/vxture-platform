/**
 * Shared Cookie-authenticated stream endpoint; hosts supply verified RP authorities.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category transport
 * @author AI-Generated
 * @date 2026-11-24
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { rpSessionCookieName } from "@vxture/core-identity-sdk";
import { rpAuthFailure } from "./rp-auth.failure";
import type { RpAuthOutcome } from "./rp-auth.service";
import type { RpSessionStore } from "./rp-session.store";
import type { SessionRecoveryAuthority } from "./session-recovery.authority";
import type { SessionEventsHub } from "./session-events.hub";
import type { IdentityChangesAuthority } from "./identity-changes.authority";

export interface SessionEventRuntime {
  defaultReturnTo: string;
  cookieSecure: boolean;
  config: { clientId: string };
  /** Host-owned existing cookie contract; never supplied by the request. */
  cookieName?: string;
  sessionPollingRetirement?: boolean;
}
export interface SessionEventRequest {
  headers: Record<string, string | string[] | undefined>;
  query: object;
  cookies?: Record<string, unknown>;
  once(event: string, listener: () => void): unknown;
}
export interface SessionEventResponse {
  destroyed: boolean;
  headersSent: boolean;
  setHeader(name: string, value: string): unknown;
  status(code: number): SessionEventResponse;
  end(): unknown;
  write(value: string): boolean;
  destroy(): unknown;
  flushHeaders(): void;
  once(event: string, listener: () => void): unknown;
}

// ============================================================================
// Hosts own routing and dependency injection; the transport owns bounded streams.
// ============================================================================
export class SessionEventsEndpoint {
  constructor(
    private readonly hub: SessionEventsHub | null,
    private readonly authority: SessionRecoveryAuthority | null,
    private readonly store: Pick<RpSessionStore, "get" | "remainingLifetimeMs">,
    private readonly auth: { resolve(id: string): Promise<RpAuthOutcome> },
    private readonly runtime: SessionEventRuntime,
    private readonly changes?: IdentityChangesAuthority | null,
  ) {}

  /**
   * Reauthenticate on every connection; reconnects always reread the current Cookie.
   * @param req Same-origin GET with the existing HttpOnly RP cookie.
   * @param res Bounded SSE stream, closed on transport loss, expiry or logout.
   * @returns Completion of setup; close handlers own the established connection.
   */
  async events(
    req: SessionEventRequest,
    res: SessionEventResponse,
  ): Promise<void> {
    res.setHeader("Cache-Control", "no-store, no-transform");
    const origin = new URL(this.runtime.defaultReturnTo).origin;
    if (
      (req.headers.origin && req.headers.origin !== origin) ||
      (req.headers["sec-fetch-site"] &&
        req.headers["sec-fetch-site"] !== "same-origin" &&
        req.headers["sec-fetch-site"] !== "none")
    )
      throw new ForbiddenException("Same-origin session stream required");
    if (
      Object.keys(req.query).length ||
      String(req.headers["last-event-id"] ?? "").length > 512
    )
      throw new BadRequestException(
        "Session stream parameters are not supported",
      );
    if (!this.hub || !this.authority) {
      res.status(204).end();
      return;
    }
    if (!this.hub.ready)
      throw new ServiceUnavailableException("Session events unavailable");
    const rpsid: unknown =
      req.cookies?.[
        this.runtime.cookieName ??
          rpSessionCookieName(
            this.runtime.cookieSecure,
            this.runtime.config.clientId,
          )
      ];
    if (typeof rpsid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(rpsid))
      throw new UnauthorizedException("No active session");

    let closed = false;
    let started = false;
    let invalidated = false;
    let checking = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let subscription: ReturnType<SessionEventsHub["subscribe"]> | undefined;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      subscription?.unsubscribe();
      if (deadline) clearTimeout(deadline);
    };
    const close = () => {
      cleanup();
      if (!res.destroyed) {
        if (!started && !res.headersSent) res.status(503);
        res.end();
      }
    };
    const write = (chunk: string) => {
      if (closed || res.destroyed) return;
      if (!res.write(chunk)) {
        cleanup();
        res.destroy();
      }
    };
    const event = (
      name:
        | "session-ended"
        | "resync-required"
        | "context-changed"
        | "access-changed",
      reason: string,
    ) => write(`event: ${name}\ndata: ${JSON.stringify({ reason })}\n\n`);
    res.once("close", cleanup);
    res.once("error", close);
    req.once("aborted", cleanup);
    try {
      const session = await this.store.get(rpsid);
      if (!session) throw new UnauthorizedException("No active session");
      if (this.changes && !(await this.changes.view(session)))
        throw new UnauthorizedException("No active session");
      let versions = await this.changes?.versions(session);
      // Register before the final auth/store reads. NOTIFY itself proves nothing.
      const recheck = async () => {
        invalidated = true;
        if (!started || checking || closed) return;
        checking = true;
        try {
          for (let pass = 0; pass < 8 && invalidated && !closed; pass += 1) {
            invalidated = false;
            const current = await this.store.get(rpsid);
            if (closed) return;
            if (!current) {
              event("session-ended", "revoked");
              close();
            } else if (
              current.sid !== session.sid ||
              current.sub !== session.sub
            )
              close();
            else if (this.changes) {
              const latest = await this.changes.versions(session);
              if (versions && latest.context !== versions.context)
                event("context-changed", "context-changed");
              if (versions && latest.access !== versions.access)
                event("access-changed", "access-changed");
              versions = latest;
            }
          }
          if (invalidated && !closed) close();
        } catch {
          close();
        } finally {
          checking = false;
        }
      };
      subscription = this.hub.subscribe(session.sid, {
        subject: session.sub,
        changed: () => {
          void recheck();
        },
        revoked: () => {
          void recheck();
        },
        disconnected: close,
        heartbeat: () => {
          if (started) write(": keepalive\n\n");
        },
      });
      if (closed) {
        subscription.unsubscribe();
        return;
      }
      const outcome = await this.auth.resolve(rpsid);
      if (outcome.status === "unavailable")
        throw new ServiceUnavailableException(rpAuthFailure(outcome));
      if (outcome.status !== "ok" || outcome.claims.sub !== session.sub)
        throw new UnauthorizedException("No active session");
      const ttlStart = Date.now();
      const ttl = await this.store.remainingLifetimeMs(rpsid);
      const expires = Math.min(
        ttlStart + ttl,
        this.authority.confirmedUntil(session),
      );
      if (expires <= Date.now())
        throw new UnauthorizedException("No active session");
      if (closed) return;
      if (!subscription.current())
        throw new ServiceUnavailableException(
          "Session events require recovery",
        );
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("X-Accel-Buffering", "no");
      if (this.runtime.sessionPollingRetirement && this.changes)
        res.setHeader("X-Vxture-Session-Sync", "events-v1");
      res.flushHeaders();
      started = true;
      invalidated = true;
      // No durable page cursor in logout-v1: every connection starts with a fresh view.
      event("resync-required", "connected");
      if (closed) return;
      deadline = setTimeout(
        () => {
          event("resync-required", "expired");
          close();
        },
        Math.min(expires - Date.now(), 2147483647),
      );
      deadline.unref();
      if (invalidated) void recheck();
    } catch (error) {
      cleanup();
      if (res.headersSent || res.destroyed) {
        if (!res.destroyed) res.end();
        return;
      }
      if (error instanceof HttpException) {
        if (error.getStatus() === 429) res.setHeader("Retry-After", "5");
        throw error;
      }
      throw new ServiceUnavailableException(
        rpAuthFailure({
          status: "unavailable",
          reauthorizationRequired: false,
        }),
      );
    }
  }
}
