/**
 * session.router.ts — 当前操作者的主体与能力码。
 * @package @vxture/bff-opera
 * @layer Application
 * @category Router
 *
 * 与 `/auth/session` 分工明确：那个出的是 **RP 令牌里的身份 claims**（登录引导用，
 * 不需要数据库）；这个出的是 **回库解析的授权**（能力码）。身份与授权是两件事，
 * 端点也分开——`/auth/*` 保持纯 OIDC 面，`/api/*` 才是数据面。
 *
 * 不重复查库：中间件已经为每个 `/api/*` 请求解析过一次并挂在 req 上，这里直接读。
 *
 * ⚠ 前端拿能力码只用于**决定界面显示什么**。真正的裁决在各 router 的能力门上——
 * 前端藏了按钮不等于接口关了，接口自己会 403。
 */
import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type {
  Capability,
  OperatorPrincipal,
  RequestContext,
} from "../types/request-context";

interface SessionView {
  operator: OperatorPrincipal;
  capabilities: Capability[];
}

@Controller("api/session")
export class SessionRouter {
  @Get()
  currentSession(@Req() req: Request & RequestContext): SessionView {
    if (!req.operator) {
      throw new UnauthorizedException("No active session");
    }
    return {
      operator: req.operator,
      capabilities: req.capabilities ?? [],
    };
  }
}
