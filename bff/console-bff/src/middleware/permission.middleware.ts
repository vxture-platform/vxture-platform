import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { SessionAggregator } from "../aggregators/session.aggregator";
import type { RequestContext } from "../types/console.types";
import { AUTH_CONTEXT_ONLY_PATHS } from "./auth-context-paths";

@Injectable()
export class PermissionMiddleware implements NestMiddleware {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    if (AUTH_CONTEXT_ONLY_PATHS.has(req.path)) {
      next();
      return;
    }

    const context = req as Request & RequestContext;
    if (context.user) {
      // P0 分权(2026-08-21):capability 按成员实际治理角色派生,不再「有租户
      // 全给」。aggregator 内部有 (tenant,user) 短 TTL 缓存,常态命中内存;
      // 回查失败降级为只读保底,绝不放大权限。
      context.capabilities = context.tenant
        ? await this.sessionAggregator.capabilitiesFor(
            context.user.id,
            context.tenant.id,
          )
        : [];
    }

    next();
  }
}
