/**
 * auth.middleware.ts - Website BFF auth (Identity Platform).
 * @package @vxture/bff-website
 *
 * Non-blocking: enriches req.user (+ req.tenantId = active_org) from the OIDC RP
 * session when present; never 401s (the website is public-facing). Legacy HS256
 * verification is retired.
 */

import {
  Inject,
  Injectable,
  Optional,
  type NestMiddleware,
} from "@nestjs/common";
import {
  rpAuthFailure,
  mapAccessClaims,
  rpSessionCookieName,
  type RpAuthService,
  type RpSessionStore,
} from "@vxture/core-oidc-rp";
import type { NextFunction, Request, Response } from "express";
import { WebsiteAuthService } from "../auth/auth.service";
import {
  RP_CHANGES,
  RP_SESSION_STORE,
  RP_AUTH_SERVICE,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/auth.types";

import type { IdentityChangesAuthority } from "../oidc/identity-changes.authority";

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(WebsiteAuthService)
    private readonly websiteAuthService: WebsiteAuthService,
    @Inject(RP_AUTH_SERVICE) private readonly rpAuth: RpAuthService,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
    @Optional()
    @Inject(RP_CHANGES)
    private readonly changes?: IdentityChangesAuthority | null,
    @Optional()
    @Inject(RP_SESSION_STORE)
    private readonly store?: RpSessionStore,
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
      if (outcome.status === "unavailable") {
        _res.status(503).setHeader("Cache-Control", "no-store");
        _res.json(rpAuthFailure(outcome));
        return;
      }
      if (outcome.status === "ok") {
        let verified = outcome.claims;
        if (this.changes) {
          try {
            const session = await this.store?.get(rpsid);
            const view =
              session && session.sub === verified.sub
                ? await this.changes.view(session)
                : null;
            if (!view || !(await this.store?.get(rpsid))) {
              next();
              return;
            }
            verified = {
              ...verified,
              active_org: view.context?.org_id ?? null,
              active_workspace: view.context?.workspace_id ?? null,
              roles: [],
            };
          } catch {
            _res.status(503).setHeader("Cache-Control", "no-store");
            _res.json({
              code: "IDENTITY_UNAVAILABLE",
              message: "Identity recovery unavailable",
            });
            return;
          }
        }
        const claims = mapAccessClaims(verified);
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
