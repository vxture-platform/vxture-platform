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
@Controller("api/capabilities")
export class CapabilitiesRouter {
  constructor(
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
  ) {}

  @Get()
  async getCapabilities(@Req() req: Request & RequestContext) {
    if (!req.user) {
      throw new UnauthorizedException("No active session");
    }

    return (
      req.capabilities ??
      this.sessionAggregator.getCapabilities(req.user.id, req.tenant?.id)
    );
  }
}
