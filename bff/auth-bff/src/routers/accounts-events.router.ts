/**
 * Same-origin Accounts invalidation stream with explicit cookie realm selection.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-24
 */
import {
  Controller,
  Get,
  Inject,
  HttpException,
  Req,
  Res,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import type { Request, Response } from "express";
import { SID_COOKIE_NAME } from "../authn/cookie";
import { SessionService } from "../authn/session.service";
import { CentralEventsHub } from "../authn/central-events.hub";
import { RealmSessionService } from "../oidc/realm-session.service";

// ============================================================================
// No subject, sid, or credential is accepted from query parameters or emitted.
// ============================================================================
@Controller("oidc")
export class AccountsEventsRouter {
  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
    @Inject(CentralEventsHub) private readonly hub: CentralEventsHub,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RealmSessionService) private readonly realms: RealmSessionService,
  ) {}

  @Get("session-events")
  async events(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader("Cache-Control", "private, no-store");
    const realm = req.query.realm;
    if (
      !["customer", "workforce"].includes(String(realm)) ||
      Object.keys(req.query).some((key) => key !== "realm")
    ) {
      res.status(400).end();
      return;
    }
    if (
      req.get("sec-fetch-site") !== "same-origin" ||
      (req.get("origin") &&
        ![
          new URL(this.config.auth.OIDC_ISSUER).origin,
          new URL(this.config.platform.LOGIN_UI_BASE_URL).origin,
        ].includes(req.get("origin")!))
    ) {
      res.status(403).end();
      return;
    }
    if (
      process.env.ACCOUNTS_SESSION_EVENTS_ENABLED !== "true" ||
      (realm === "workforce" &&
        process.env.WORKFORCE_IDENTITY_SYNC_ENABLED !== "true")
    ) {
      res.status(204).end();
      return;
    }
    const sid: unknown =
      req.cookies?.[
        realm === "workforce"
          ? SID_COOKIE_NAME.operator
          : SID_COOKIE_NAME.tenant
      ];
    if (typeof sid !== "string") throw new UnauthorizedException();
    const resolve = async () => {
      try {
        return realm === "workforce"
          ? await this.realms.requireOperator(sid)
          : (await this.realms.requireCustomer(sid)).userId;
      } catch (error) {
        if (error instanceof HttpException) throw error;
        throw new ServiceUnavailableException("Session authority unavailable");
      }
    };
    const sub = await resolve();
    let ended = false;
    let unsubscribe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      ended = true;
      unsubscribe?.();
      clearInterval(heartbeat);
      clearTimeout(expiry);
      res.end();
    };
    const send = (reason: "connected" | "access-changed" | "expired") => {
      if (!res.headersSent || ended) return;
      if (
        !res.write(
          `event: resync-required\ndata: ${JSON.stringify({ reason })}\n\n`,
        )
      )
        close();
    };
    res.once("close", close);
    try {
      unsubscribe = await this.hub.subscribe({
        realm: String(realm),
        sid,
        sub,
        changed: () => send("access-changed"),
        close,
      });
      const durable = await this.sessions.get(sid);
      if (
        (await resolve()) !== sub ||
        !durable ||
        durable.realm !== realm ||
        durable.userId !== sub
      )
        throw new UnauthorizedException();
      if (ended) {
        unsubscribe();
        return;
      }
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
        "X-Vxture-Session-Sync": "events-v1",
      });
      res.flushHeaders();
      send("connected");
      heartbeat = setInterval(() => {
        if (!res.write(": heartbeat\n\n")) close();
      }, 25000);
      expiry = setTimeout(
        () => {
          send("expired");
          close();
        },
        Math.min(
          2147483647,
          Math.max(1, durable.expiresAt.getTime() - Date.now()),
        ),
      );
    } catch (error) {
      unsubscribe?.();
      res.removeListener("close", close);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Session authority unavailable");
    }
  }
}
