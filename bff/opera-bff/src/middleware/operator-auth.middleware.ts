/**
 * operator-auth.middleware.ts — opera 数据面的操作者鉴权。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 与 admin-bff 的 AuthMiddleware 同构：解析不透明的 operator RP 会话 → 强制 realm
 * 隔离（userType 必须是 operator）→ 回库取细粒度能力码（RP 令牌不带 operator 权限）。
 * 任一环节不成立即 401。
 *
 * **只挂在 /api/* 上**：`/auth/*` 是登录出入口，挂上去会把自己锁在门外。
 */
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { rpSessionCookieName, type RpAuthService } from "@vxture/core-oidc-rp";
import type { NextFunction, Request, Response } from "express";
import { OperatorAuthzService } from "../auth/operator-authz.service";
import {
  RP_AUTH_SERVICE,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/request-context";

/** `opr_<uuid>` → `<uuid>`；已经是裸 id 的原样返回。 */
function stripSubPrefix(sub: string): string {
  const i = sub.indexOf("_");
  return i >= 0 ? sub.slice(i + 1) : sub;
}

@Injectable()
export class OperatorAuthMiddleware implements NestMiddleware {
  constructor(
    @Inject(OperatorAuthzService)
    private readonly authz: OperatorAuthzService,
    @Inject(RP_AUTH_SERVICE) private readonly rpAuth: RpAuthService,
    @Inject(RP_RUNTIME) private readonly rpRuntime: RpRuntime,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
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
    // 纵深防御：租户令牌结构上到不了这里（aud 在验签时已限定），这一层再挡一次。
    if (outcome.claims.userType !== "operator") {
      unauthorized();
      return;
    }

    const operatorId = stripSubPrefix(String(outcome.claims.sub ?? ""));
    const resolved = await this.authz.resolve(operatorId);
    if (!resolved) {
      unauthorized();
      return;
    }

    const context = req as Request & RequestContext;
    context.operator = resolved.operator;
    context.capabilities = resolved.capabilities;
    next();
  }
}
