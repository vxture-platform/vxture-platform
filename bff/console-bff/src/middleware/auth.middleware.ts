import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import {
  JwtAuthScope,
  JwtUserType,
  OAuthProviderType,
  type JwtAccessPayload,
} from "@vxture/core-auth";
import {
  mapAccessClaims,
  rpSessionCookieName,
  type RpAuthService,
} from "@vxture/core-oidc-rp";
import type { NextFunction, Request, Response } from "express";
import { ConsoleAuthService } from "../auth/auth.service";
import {
  RP_AUTH_SERVICE,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/console.types";

/** Org-scope governance role from the scope-prefixed roles claim (e.g. org:owner → owner). */
function deriveOrgRole(roles: string[]): string {
  const r = roles.find((x) => x.startsWith("org:"));
  return r ? r.slice("org:".length) : "member";
}

/**
 * Map verified OIDC access-token claims (sub + active_org + active_workspace +
 * roles) to the console request context. The legacy JwtAccessPayload shape is
 * kept as a bridge (tenantId carries the active_org id, role is the org role) so
 * downstream tenant.middleware/routers keep working without a wider rename.
 */
function claimsToPayload(claims: Record<string, unknown>): JwtAccessPayload {
  const u = mapAccessClaims(claims);
  return {
    sub: u.userId,
    tenantId: u.activeOrg ?? "",
    email: (claims.email as string | undefined) ?? "",
    role: deriveOrgRole(u.roles),
    userType: JwtUserType.TENANT_USER,
    authScope: JwtAuthScope.TENANT_CONSOLE,
    permissions: [],
    provider: OAuthProviderType.PASSWORD,
  };
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(ConsoleAuthService)
    private readonly consoleAuthService: ConsoleAuthService,
    @Inject(RP_AUTH_SERVICE) private readonly rpAuth: RpAuthService,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    // OIDC RP session is the only auth path (legacy HS256 retired). The cookie
    // holds an opaque rpsid; tokens stay server-side (RpAuthService).
    const rpsid = req.cookies?.[
      rpSessionCookieName(
        this.rpRuntime.cookieSecure,
        this.rpRuntime.config.clientId,
      )
    ] as string | undefined;
    const unauthorized = () =>
      res
        .status(401)
        .json({ code: "UNAUTHORIZED", message: "No active session" });

    if (!rpsid) {
      unauthorized();
      return;
    }
    const outcome = await this.rpAuth.resolve(rpsid);
    if (outcome.status !== "ok") {
      unauthorized();
      return;
    }
    const payload = claimsToPayload(outcome.claims);
    const user = await this.consoleAuthService.getCurrentUser(payload.sub);
    if (!user) {
      unauthorized();
      return;
    }
    const context = req as Request & RequestContext;
    context.auth = payload;
    context.user = user;
    next();
  }
}
