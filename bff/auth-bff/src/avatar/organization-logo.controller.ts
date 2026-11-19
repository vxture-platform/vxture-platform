/**
 * Public, content-versioned organization presentation images.
 * @package @vxture/bff-auth
 * @layer Application
 * @category controller
 * @author AI-Generated
 * @date 2026-11-19
 */
import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { sniffImageType } from "@vxture/service-account";
import { OrganizationService } from "@vxture/service-organization";

@Controller("avatar/organization")
export class OrganizationLogoController {
  constructor(
    @Inject(OrganizationService)
    private readonly organization: OrganizationService,
  ) {}

  /** Serve only the current version of a live organization's raster logo. */
  @Get(":orgId/:hash")
  async serve(
    @Param("orgId") orgId: string,
    @Param("hash") hash: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        orgId,
      ) ||
      !/^[0-9a-f]{64}$/.test(hash)
    ) {
      res.status(404).end();
      return;
    }
    const logo = await this.organization.getPublicOrgLogo(orgId, hash);
    const contentType = logo ? sniffImageType(logo.data) : null;
    if (
      !logo ||
      !contentType ||
      logo.hash !== hash ||
      createHash("sha256").update(logo.data).digest("hex") !== hash
    ) {
      res.status(404).end();
      return;
    }
    const etag = `"${hash}"`;
    res.setHeader("ETag", etag);
    // Removal takes effect at origin immediately; fresh public caches last at most five minutes.
    res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    const validators = req.headers["if-none-match"]
      ?.split(",")
      .map((v) => v.trim());
    if (validators?.some((v) => v === "*" || v.replace(/^W\//, "") === etag)) {
      res.status(304).end();
      return;
    }
    res.setHeader("Content-Type", contentType);
    res.end(logo.data);
  }
}
