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
import {
  rpSessionCookieName,
  type OidcRpClient,
  type RpSessionStore,
} from "@vxture/core-oidc-rp";
import { clearPresenceCookie } from "@vxture/core-identity-sdk";
import {
  RP_OIDC_CLIENT,
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
    @Inject(RP_OIDC_CLIENT) private readonly client: OidcRpClient,
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

  /**
   * 登出。与 `/auth/logout`（OidcAuthRouter）**行为必须一致**——两个口都还有调用方
   * （这一口是 AUTH_ROUTES.LOGOUT 的共用约定，console/website 也照它），谁少做一步，
   * 谁那条路上的登出就是坏的。此前这一口就少做两步：不清 presence、不给 end_session
   * 地址，而 SPA 调的恰好是它。
   *
   * 语义见 `/auth/logout` 的说明：本地清理在这里做完，中央会话由前端顶层跳转结束。
   */
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const rpsid = req.cookies?.[this.cookieName] as string | undefined;
    const session = rpsid ? await this.store.get(rpsid) : null;
    if (rpsid) await this.store.destroy(rpsid);
    res.clearCookie(this.cookieName, { path: "/" });
    const presence = clearPresenceCookie(
      this.rt.config.clientId,
      this.rt.cookieSecure,
    );
    res.clearCookie(presence.name, presence.options);
    res.json({
      status: "logged_out",
      endSessionUrl: this.client.buildEndSessionUrl({
        ...(session ? { idTokenHint: session.idToken } : {}),
        postLogoutRedirectUri: this.rt.defaultReturnTo,
      }),
    });
  }
}
