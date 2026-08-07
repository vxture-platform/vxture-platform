/**
 * auth.router.ts - operator session endpoints (Identity Platform).
 * @package @vxture/bff-admin
 *
 * Operator login is now the IdP (auth-bff, RS256) via the OIDC-RP flow at
 * /auth/* (OidcAuthRouter). This controller keeps only the two API-surface
 * helpers the admin SPA calls: session state (from the RP-resolved req.user) and
 * local logout (drop the RP session + clear its cookie). The legacy local
 * DB-password login + HS256 delegate-sign + Turnstile/rate-limit/phone-code are
 * retired (Batch 8, D-Y/D-W); brute-force + bot protection moved to the IdP.
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { rpSessionCookieName, type RpSessionStore } from "@vxture/core-oidc-rp";
import {
  RP_RUNTIME,
  RP_SESSION_STORE,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/console.types";

@Controller("api/auth")
export class AuthRouter {
  constructor(
    @Inject(RP_SESSION_STORE) private readonly store: RpSessionStore,
    @Inject(RP_RUNTIME) private readonly rt: RpRuntime,
  ) {}

  private get cookieName(): string {
    return rpSessionCookieName(this.rt.cookieSecure, this.rt.config.clientId);
  }

  /** Current operator session state (req.user is populated by AuthMiddleware). */
  @Get("session")
  getSessionState(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }
    return { status: "active", userId: req.user.id };
  }

  /** Local logout: drop the RP session + clear its cookie (IdP session unaffected). */
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const rpsid = req.cookies?.[this.cookieName] as string | undefined;
    if (rpsid) await this.store.destroy(rpsid);
    res.clearCookie(this.cookieName, { path: "/" });
    res.json({ status: "logged_out" });
  }
}
