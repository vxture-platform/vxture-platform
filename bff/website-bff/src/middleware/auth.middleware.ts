/**
 * auth.middleware.ts - Website BFF auth (Identity Platform).
 * @package @vxture/bff-website
 *
 * Non-blocking: enriches req.user (+ req.tenantId = active_org) from the OIDC RP
 * session when present; never 401s (the website is public-facing). Legacy HS256
 * verification is retired.
 */

import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import {
  mapAccessClaims,
  rpSessionCookieName,
  type RpAuthService,
} from "@vxture/core-oidc-rp";
import type { NextFunction, Request, Response } from "express";
import { WebsiteAuthService } from "../auth/auth.service";
import {
  RP_AUTH_SERVICE,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/auth.types";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(WebsiteAuthService)
    private readonly websiteAuthService: WebsiteAuthService,
    @Inject(RP_AUTH_SERVICE) private readonly rpAuth: RpAuthService,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // Non-blocking enrichment: the only /api/* routes are the RP-backed MeRouter;
    // anonymous requests (no/invalid RP cookie) simply fall through.
    const rpsid = req.cookies?.[
      rpSessionCookieName(
        this.rpRuntime.cookieSecure,
        this.rpRuntime.config.clientId,
      )
    ] as string | undefined;
    if (rpsid) {
      const outcome = await this.rpAuth.resolve(rpsid);
      if (outcome.status === "ok") {
        const claims = mapAccessClaims(outcome.claims);
        const user = await this.websiteAuthService.getCurrentUser(
          claims.userId,
        );
        if (user) {
          const ctx = req as Request & RequestContext;
          ctx.user = user;
          if (claims.activeOrg) ctx.tenantId = claims.activeOrg;
        }
      }
    }
    // Non-blocking: anonymous requests proceed.
    next();
  }
}
