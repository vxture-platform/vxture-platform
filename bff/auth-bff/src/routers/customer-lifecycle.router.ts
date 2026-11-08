/**
 * Customer lifecycle routes with explicit recovery-only authorization.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
// ⚠️ 跨层引用: The public config API supplies the customer cookie domain.
import { VxConfigService } from "@vxture/core-config";
import {
  CustomerSelfGuard,
  ACCOUNT_RECOVERY,
  type CustomerSelfRequest,
} from "../authn/customer-self.guard";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import { CustomerLifecycleService } from "../oidc/customer-lifecycle.service";
import { SID_COOKIE_NAME, HINT_COOKIE_NAME } from "../authn/cookie";

// ============================================================================
// Each recovery mutation is explicitly marked; ordinary writes stay read-only
// ============================================================================

@Controller("oidc/customer/self/deletion")
@UseGuards(CustomerSelfGuard)
export class CustomerLifecycleRouter {
  constructor(
    @Inject(CustomerLifecycleService)
    private readonly lifecycle: CustomerLifecycleService,
    @Inject(CustomerSecurityChallengeService)
    private readonly challenges: CustomerSecurityChallengeService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  view(@Req() req: CustomerSelfRequest) {
    return this.lifecycle.view(req.customer);
  }

  @Post("challenges")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  start(@Req() req: CustomerSelfRequest, @Body() body: unknown) {
    return this.lifecycle.start(req.customer, body);
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

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async request(
    @Req() req: CustomerSelfRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.lifecycle.request(req.customer, body);
    const domain = this.config.platform.COOKIE_DOMAIN_PLATFORM;
    const options = { path: "/", ...(domain ? { domain } : {}) };
    res.clearCookie(SID_COOKIE_NAME.tenant, options);
    res.clearCookie(HINT_COOKIE_NAME, options);
    return result;
  }

  @Post("recovery/challenges")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @SetMetadata(ACCOUNT_RECOVERY, true)
  startRecovery(@Req() req: CustomerSelfRequest, @Body() body: unknown) {
    return this.lifecycle.start(req.customer, body, true);
  }

  @Post("recovery/challenges/:id/verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @SetMetadata(ACCOUNT_RECOVERY, true)
  verifyRecovery(
    @Req() req: CustomerSelfRequest,
    @Param("id") id: string,
    @Body() body: { code?: unknown },
  ) {
    return this.challenges.verify(req.customer, id, body?.code);
  }

  @Post("cancel")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @SetMetadata(ACCOUNT_RECOVERY, true)
  recover(@Req() req: CustomerSelfRequest, @Body() body: unknown) {
    return this.lifecycle.recover(req.customer, body);
  }
}
