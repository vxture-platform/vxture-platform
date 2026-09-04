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
    // 删除保留期(050-account §7):账号还在、能登录,但工作台不可用——只放行会话恢复
    // 的几条读与删除相关的三条,其余一律 403,前端据码画「撤销删除并重新启用」。
    if (user.accountStatus === "deleting" && !isDeletionAllowedRoute(req)) {
      res.status(403).json({
        code: "ACCOUNT_DELETING",
        message: "account_deleting",
        deletionRequestedAt: user.deletionRequestedAt ?? null,
      });
      return;
    }
    next();
  }
}

const DELETION_READ_ALLOWLIST = new Set([
  "/api/me",
  "/api/tenant-context",
  "/api/tenant-context/options",
  "/api/capabilities",
]);

/** 保留期内仍可达的路由:会话恢复读(GET)+ 删除资格 / 撤销(任意方法)。 */
export function isDeletionAllowedRoute(
  req: Pick<Request, "method" | "originalUrl" | "url">,
): boolean {
  const raw = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
  if (path === "/api/me/deletion" || path === "/api/me/deletion/cancel") {
    return true;
  }
  return req.method === "GET" && DELETION_READ_ALLOWLIST.has(path);
}
