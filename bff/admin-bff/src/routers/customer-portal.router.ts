/**
 * Session-scoped portal configuration management.
 * @package @vxture/bff-admin
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
  Query,
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
import { assertAnyCapability } from "../auth/capability";
import { RequireStepUp } from "../auth/step-up.decorator";
import { ADMIN_BFF_RO_POOL, ADMIN_BFF_RW_POOL } from "../tokens";

// ============================================================================
// Platform-only binding, delegation and publication
// ============================================================================
@Controller("api/tenants/:tenantId/customer-portal")
export class CustomerPortalRouter {
  constructor(
    @Inject(ADMIN_BFF_RO_POOL) private readonly readPool: Pool,
    @Inject(ADMIN_BFF_RW_POOL) private readonly writePool: Pool,
  ) {}
  private actor(req: Request & RequestContext, write = false): PortalActor {
    assertAnyCapability(
      req,
      write
        ? ["tenant:profile.manage"]
        : ["tenant:profile.read", "tenant:profile.manage"],
    );
    if (!req.user) throw new UnauthorizedException();
    return { id: req.user.id, surface: "admin" };
  }
  @Get()
  async get(
    @Req() req: Request & RequestContext,
    @Param("tenantId") identifier: string,
  ) {
    const actor = this.actor(req);
    const service = new CustomerPortalService(this.readPool);
    return {
      portal: await service.get(await service.tenantId(identifier), actor),
    };
  }
  @Get("hostname-availability")
  async checkHostname(
    @Req() req: Request & RequestContext,
    @Param("tenantId") identifier: string,
    @Query("prefix") prefix: unknown,
  ) {
    const actor = this.actor(req, true);
    const service = new CustomerPortalService(this.readPool);
    return service.checkHostname(
      await service.tenantId(identifier),
      prefix,
      actor,
    );
  }

  @Put("binding")
  @RequireStepUp()
  async provision(
    @Req() req: Request & RequestContext,
    @Param("tenantId") identifier: string,
    @Body() body: unknown,
  ) {
    const actor = this.actor(req, true);
    const service = new CustomerPortalService(this.writePool);
    return service.provision(await service.tenantId(identifier), body, actor);
  }
  @Put("draft")
  async save(
    @Req() req: Request & RequestContext,
    @Param("tenantId") identifier: string,
    @Body() body: unknown,
  ) {
    const actor = this.actor(req, true);
    const service = new CustomerPortalService(this.writePool);
    return service.save(await service.tenantId(identifier), body, actor);
  }
  @Post("submissions")
  async submit(
    @Req() req: Request & RequestContext,
    @Param("tenantId") identifier: string,
    @Body() body: unknown,
  ) {
    const actor = this.actor(req, true);
    const service = new CustomerPortalService(this.writePool);
    return service.submit(await service.tenantId(identifier), body, actor);
  }
  @Post("versions/:versionId/actions")
  @RequireStepUp()
  async transition(
    @Req() req: Request & RequestContext,
    @Param("tenantId") identifier: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
  ) {
    const actor = this.actor(req, true);
    const service = new CustomerPortalService(this.writePool);
    return service.transition(
      await service.tenantId(identifier),
      versionId,
      body,
      actor,
    );
  }
  @Post("assets")
  async upload(
    @Req() req: Request & RequestContext,
    @Param("tenantId") identifier: string,
  ) {
    const actor = this.actor(req, true);
    if (!Buffer.isBuffer(req.body))
      throw new BadRequestException("Expected image bytes");
    const service = new CustomerPortalService(this.writePool);
    return service.upload(await service.tenantId(identifier), req.body, actor);
  }
  @Get("assets/:hash")
  async asset(
    @Req() req: Request & RequestContext,
    @Param("tenantId") identifier: string,
    @Param("hash") hash: string,
    @Res() res: Response,
  ) {
    const actor = this.actor(req);
    const service = new CustomerPortalService(this.readPool);
    const portal = await service.get(await service.tenantId(identifier), actor);
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
