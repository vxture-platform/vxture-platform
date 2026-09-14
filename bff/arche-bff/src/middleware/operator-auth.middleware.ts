/**
 * operator-auth.middleware.ts — arche 数据面的操作者鉴权。
 * @package @vxture/bff-arche
 * @layer BFF
 *
 * 与 admin-bff 的 AuthMiddleware 同构：解析不透明的 operator RP 会话 → 强制 realm
 * 隔离（userType 必须是 operator）→ 回库取细粒度能力码（RP 令牌不带 operator 权限）。
 * 任一环节不成立即 401；主体成立但没有本平台根码（`arche.plane`）即 403。
 *
 * **只挂在 /api/* 上**：`/auth/*` 是登录出入口，挂上去会把自己锁在门外。
 */
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { rpSessionCookieName, type RpAuthService } from "@vxture/core-oidc-rp";
import type { NextFunction, Request, Response } from "express";
import { OperatorAuthzService } from "../auth/operator-authz.service";
import { PLANE_GATE_EXEMPT_PATHS, PLANE_ROOT } from "../auth/plane";
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
    /* 中间件在过滤器之前、自己写响应——出口那层兜不到这里，封套只能就地补齐
       （product_251 X-1）。码与 router 层统一用 `AUTH_NO_SESSION`：原来这里是
       `UNAUTHORIZED`，同一件事在中间件与 router 两处两个码，消费方要判两次。
       `retryable: false`——重发同一个请求不会突然有会话，得先去登录。 */
    const unauthorized = () =>
      res.status(401).json({
        code: "AUTH_NO_SESSION",
        message: "No active session",
        retryable: false,
        statusCode: 401,
      });

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
    const sid = outcome.claims.sid;
    if (typeof sid === "string" && sid) context.sessionId = sid;

    /* 平台门（owner 2026-09-14，三平台严格隔离）：进得了 IdP 的运营账号不等于进得了
       本平台。根码由授权闭包自动授予，能做本平台任一件事的角色都有它；没有的一律 403，
       而不是放进来再逐页 403。会话端点例外——门户靠它说清「没有进入本平台的权限」。 */
    const path = (req.originalUrl.split("?")[0] ?? "").replace(/\/+$/, "");
    if (
      !resolved.capabilities.includes(PLANE_ROOT) &&
      !PLANE_GATE_EXEMPT_PATHS.has(path)
    ) {
      res.status(403).json({
        code: "NOT_ENTITLED",
        message: `Missing ${PLANE_ROOT} capability`,
        retryable: false,
        statusCode: 403,
      });
      return;
    }
    next();
  }
}
