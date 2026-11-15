/**
 * Public branding and the membership-gated workspace projection.
 * @package @vxture/bff-customer-portal
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-15
 */
import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { PortalGateway } from "./gateway";
import { failure } from "./errors";

@Controller("api/portal")
export class PortalRouter {
  constructor(@Inject(PortalGateway) private readonly gateway: PortalGateway) {}

  @Get()
  async brand(@Req() req: Request) {
    const { runtime } = await this.gateway.context(req);
    const {
      name,
      title,
      subtitle,
      brandColor,
      appearance,
      density,
      logo,
      favicon,
      background,
    } = runtime.binding.configuration;
    return {
      name,
      title,
      subtitle,
      brandColor,
      appearance,
      density,
      logo,
      favicon,
      background,
    };
  }

  @Get("assets/:hash")
  async asset(
    @Req() req: Request,
    @Param("hash") hash: string,
    @Res() res: Response,
  ) {
    const { runtime } = await this.gateway.context(req);
    const { logo, favicon, background } = runtime.binding.configuration;
    if (![logo, favicon, background].includes(hash))
      throw failure(404, "CUSTOMER_PORTAL_ASSET_NOT_FOUND", "素材不存在");
    const asset = await this.gateway.portals.asset(runtime.binding.id, hash);
    res.type(asset.mime).send(asset.bytes);
  }

  @Get("workspace")
  async workspace(@Req() req: Request) {
    const context = await this.gateway.context(req);
    const { member } = await this.gateway.authenticate(req, context);
    return {
      ...member,
      apps: await this.gateway.portals.applications(context.runtime.binding),
    };
  }
}
