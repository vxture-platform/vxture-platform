/**
 * Customer security ceremonies and self-service execution.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
// ⚠️ 跨层引用: Read cookie scope from the public configuration API.
import { VxConfigService } from "@vxture/core-config";
import {
  CustomerSelfGuard,
  type CustomerSelfRequest,
} from "../authn/customer-self.guard";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import { SocialAuthService } from "../oauth/social-auth.service";
import { CustomerSecurityService } from "../oidc/customer-security.service";
import { SID_COOKIE_NAME, HINT_COOKIE_NAME } from "../authn/cookie";

// ============================================================================
// Ownership ceremonies
// ============================================================================

@Controller("oidc/customer/self/security")
@UseGuards(CustomerSelfGuard)
export class CustomerSecurityRouter {
  constructor(
    @Inject(CustomerSecurityService)
    private readonly security: CustomerSecurityService,
    @Inject(CustomerSecurityChallengeService)
    private readonly challenges: CustomerSecurityChallengeService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
    @Inject(SocialAuthService) private readonly social: SocialAuthService,
  ) {}
  @Post("identity-link")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async link(
    @Req() req: CustomerSelfRequest,
    @Body() body: { provider?: unknown; challengeId?: unknown },
  ) {
    if (
      typeof body?.provider !== "string" ||
      typeof body.challengeId !== "string"
    )
      throw new BadRequestException("invalid_request");
    return {
      url: await this.social.buildLinkStartUrl(
        req.customer,
        body.provider,
        body.challengeId,
      ),
    };
  }

  @Post("challenges")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  start(@Req() req: CustomerSelfRequest, @Body() body: unknown) {
    return this.security.start(req.customer, body);
  }

  @Post("challenges/:id/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  verify(
    @Req() req: CustomerSelfRequest,
    @Param("id") id: string,
    @Body() body: { code?: unknown },
  ) {
    return this.challenges.verify(req.customer, id, body?.code);
  }

  @Post("challenges/:id/target")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  sendTarget(@Req() req: CustomerSelfRequest, @Param("id") id: string) {
    return this.challenges.sendTarget(req.customer, id);
  }

  @Post("challenges/:id/target/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  verifyTarget(
    @Req() req: CustomerSelfRequest,
    @Param("id") id: string,
    @Body() body: { code?: unknown },
  ) {
    return this.challenges.verify(req.customer, id, body?.code, true);
  }

  @Post("challenges/:id/execute")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async execute(
    @Req() req: CustomerSelfRequest,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.security.execute(req.customer, id, body);
    const domain = this.config.platform.COOKIE_DOMAIN_PLATFORM;
    const options = { path: "/", ...(domain ? { domain } : {}) };
    res.clearCookie(SID_COOKIE_NAME.tenant, options);
    res.clearCookie(HINT_COOKIE_NAME, options);
    return result;
  }
}
