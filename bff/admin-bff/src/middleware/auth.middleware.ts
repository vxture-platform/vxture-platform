import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { rpSessionCookieName, type RpAuthService } from "@vxture/core-oidc-rp";
import type { NextFunction, Request, Response } from "express";
import { PlatformAuthService } from "../auth/auth.service";
import {
  RP_AUTH_SERVICE,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/console.types";

/** opr_<id> → <id> (admin.operator_account UUID); leaves a bare id unchanged. */
function stripSubPrefix(sub: string): string {
  const i = sub.indexOf("_");
  return i >= 0 ? sub.slice(i + 1) : sub;
}

/** Login entry points that must stay reachable without a session. */
const PUBLIC_AUTH_PATHS = new Set(["/api/auth/login", "/api/auth/logout"]);

/**
 * Operator auth is OIDC-RP only (legacy HS256 retired). Resolve the opaque
 * operator RP session, enforce realm isolation (userType=operator; aud=admin is
 * enforced at token verification), then re-query fine-grained authorization from
 * ops.* via PlatformAuthService (the RP token carries no operator permissions).
 * Any miss → 401.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(PlatformAuthService)
    private readonly platformAuthService: PlatformAuthService,
    @Inject(RP_AUTH_SERVICE) private readonly rpAuth: RpAuthService,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (PUBLIC_AUTH_PATHS.has(req.path)) {
      next();
      return;
    }

    const unauthorized = () =>
      res
        .status(401)
        .json({ code: "UNAUTHORIZED", message: "No active session" });

    const rpsid = req.cookies?.[
      rpSessionCookieName(
        this.rpRuntime.cookieSecure,
        this.rpRuntime.config.clientId,
      )
    ] as string | undefined;
    if (!rpsid) {
      unauthorized();
      return;
    }

    const outcome = await this.rpAuth.resolve(rpsid);
    if (outcome.status !== "ok") {
      unauthorized();
      return;
    }
    // Defense in depth: reject any non-operator token reaching admin (a tenant
    // token is structurally refused — aud=admin is enforced at verification).
    if (outcome.claims.userType !== "operator") {
      unauthorized();
      return;
    }

    const operatorId = stripSubPrefix(String(outcome.claims.sub ?? ""));
    const user = await this.platformAuthService.getCurrentUser(operatorId);
    if (!user) {
      unauthorized();
      return;
    }

    const capabilities =
      await this.platformAuthService.getCapabilities(operatorId);
    const context = req as Request & RequestContext;
    context.user = user;
    context.capabilities = capabilities;
    // Kept for operator-OBO exchange when proxying to provider management
    // APIs (product_250 M-1); never serialized into any response.
    context.operatorAccessToken = outcome.accessToken;
    next();
  }
}
