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
      // Permissions include only roles in the verified active workspace.
      // The aggregator caches by tenant, user, and workspace and fails conservatively.
      context.capabilities = context.tenant
        ? await this.sessionAggregator.capabilitiesFor(
            context.user.id,
            context.tenant.id,
            context.tenant.workspace === "default"
              ? undefined
              : context.tenant.workspace,
          )
        : [];
    }

    next();
  }
}
