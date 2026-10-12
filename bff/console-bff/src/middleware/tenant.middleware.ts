import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { SessionAggregator } from "../aggregators/session.aggregator";
import type { RequestContext } from "../types/console.types";
import { AUTH_CONTEXT_ONLY_PATHS } from "./auth-context-paths";

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (AUTH_CONTEXT_ONLY_PATHS.has(req.path)) {
      next();
      return;
    }

    const context = req as Request & RequestContext;
    if (!context.user) {
      next();
      return;
    }

    const tenantId = context.auth?.tenantId?.trim();
    if (!tenantId) {
      res.status(401).json({ message: "Tenant context is required" });
      return;
    }

    const tenant = await this.sessionAggregator.getTenantContext(
      context.user.id,
      tenantId,
      context.activeWorkspaceId,
    );
    if (tenant.mode !== "tenant") {
      res.status(403).json({ message: "Tenant context is not accessible" });
      return;
    }

    context.tenant = tenant;
    next();
  }
}
