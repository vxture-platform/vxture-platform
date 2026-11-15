/**
 * Session-scoped portal configuration management.
 * @package @vxture/bff-console
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-15
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import {
  CustomerPortalService,
  type PortalActor,
} from "@vxture/service-customer-portal"; // ⚠️ Cross-layer reference: delegate lifecycle to the portal domain.
import type { RequestContext } from "../types/console.types";
import { RequireCapability } from "../auth/capability";

// ============================================================================
// Body parameters never select an organization or confer publication authority.
// ============================================================================
@RequireCapability("tenant.settings.manage")
@Controller("api/customer-portal")
export class CustomerPortalRouter {
  constructor(@Inject("COMMERCE_PG_POOL") private readonly pool: Pool) {}
  private context(req: Request & RequestContext): {
    tenantId: string;
    actor: PortalActor;
  } {
    if (!req.user || !req.tenant) throw new UnauthorizedException();
    return {
      tenantId: req.tenant.id,
      actor: { id: req.user.id, surface: "console" },
    };
  }
  @Get("availability")
  async availability(@Req() req: Request & RequestContext) {
    const { tenantId } = this.context(req);
    return {
      available: await new CustomerPortalService(
        this.pool,
      ).selfServiceAvailable(tenantId),
    };
  }
  @Get()
  async get(@Req() req: Request & RequestContext) {
    const { tenantId, actor } = this.context(req);
    return {
      portal: await new CustomerPortalService(this.pool).get(tenantId, actor),
    };
  }
  @Put("draft")
  async save(@Req() req: Request & RequestContext, @Body() body: unknown) {
    const { tenantId, actor } = this.context(req);
    return new CustomerPortalService(this.pool).save(tenantId, body, actor);
  }
  @Post("submissions")
  async submit(@Req() req: Request & RequestContext, @Body() body: unknown) {
    const { tenantId, actor } = this.context(req);
    return new CustomerPortalService(this.pool).submit(tenantId, body, actor);
  }
  @Post("versions/:versionId/withdraw")
  async withdraw(
    @Req() req: Request & RequestContext,
    @Param("versionId") versionId: string,
  ) {
    const { tenantId, actor } = this.context(req);
    return new CustomerPortalService(this.pool).transition(
      tenantId,
      versionId,
      { action: "withdraw" },
      actor,
    );
  }
  @Post("assets")
  async upload(@Req() req: Request & RequestContext) {
    const { tenantId, actor } = this.context(req);
    if (!Buffer.isBuffer(req.body))
      throw new BadRequestException("Expected image bytes");
    return new CustomerPortalService(this.pool).upload(
      tenantId,
      req.body,
      actor,
    );
  }
  @Get("assets/:hash")
  async asset(
    @Req() req: Request & RequestContext,
    @Param("hash") hash: string,
    @Res() res: Response,
  ) {
    const { tenantId, actor } = this.context(req);
    const service = new CustomerPortalService(this.pool);
    const portal = await service.get(tenantId, actor);
    if (!portal) throw new BadRequestException("Portal is not provisioned");
    const asset = await service.asset(portal.id, hash);
    res
      .set({
        "Content-Type": asset.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      })
      .send(asset.bytes);
  }
}
