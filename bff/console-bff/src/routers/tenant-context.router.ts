import {
  Controller,
  Get,
  Inject,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { SessionAggregator } from "../aggregators/session.aggregator";
import type { RequestContext } from "../types/console.types";
import { SelfScope } from "../auth/capability";

@SelfScope()
@Controller("api/tenant-context")
export class TenantContextRouter {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
  ) {}

  @Get()
  async getTenantContext(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }
    if (!req.tenant) {
      throw new UnauthorizedException("Tenant context is required");
    }

    // 展示端点：补 workspace 名称/可视码（中间件路径为省每请求一查不富化）。
    return this.sessionAggregator.withWorkspaceMeta(req.tenant);
  }

  @Get("options")
  async getTenantOptions(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    return this.sessionAggregator.getTenantContexts(req.user.id);
  }
}
