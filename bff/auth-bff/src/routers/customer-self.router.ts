/**
 * Customer account-center endpoints on the accounts origin.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-07
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
// ⚠️ 跨层引用: Use the public service or configuration API for identity orchestration.
import { VxConfigService } from "@vxture/core-config";
import type { Response } from "express";
import {
  CustomerSelfGuard,
  type CustomerSelfRequest,
} from "../authn/customer-self.guard";
import { SID_COOKIE_NAME, HINT_COOKIE_NAME } from "../authn/cookie";
import { CustomerSelfService } from "../oidc/customer-self.service";

// ============================================================================
// Customer profile and security
// ============================================================================

@Controller("oidc/customer/self")
@UseGuards(CustomerSelfGuard)
export class CustomerSelfRouter {
  constructor(
    @Inject(CustomerSelfService) private readonly self: CustomerSelfService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** Read the customer's independent account profile. */
  @Get()
  @Header("Cache-Control", "no-store")
  getSelf(@Req() req: CustomerSelfRequest) {
    return this.self.getProfile(req.customer);
  }

  /** Update non-security profile fields. */
  @Patch()
  @Header("Cache-Control", "no-store")
  updateProfile(@Req() req: CustomerSelfRequest, @Body() body: unknown) {
    return this.self.updateProfile(req.customer, body);
  }

  /** Read contacts and login-method status. */
  @Get("security")
  @Header("Cache-Control", "no-store")
  getSecurity(@Req() req: CustomerSelfRequest) {
    return this.self.getSecurity(req.customer);
  }

  // ============================================================================
  // Activity and device management
  // ============================================================================

  /** Read the latest twenty login attempts. */
  @Get("login-history")
  @Header("Cache-Control", "no-store")
  getLoginHistory(@Req() req: CustomerSelfRequest) {
    return this.self.getLoginHistory(req.customer);
  }

  /** Read active customer sessions. */
  @Get("sessions")
  @Header("Cache-Control", "no-store")
  getSessions(@Req() req: CustomerSelfRequest) {
    return this.self.getSessions(req.customer);
  }

  /** End a customer session and clear customer cookies when ending this browser's session. */
  @Delete("sessions/:sid")
  @Header("Cache-Control", "no-store")
  async revokeSession(
    @Req() req: CustomerSelfRequest,
    @Param("sid") sid: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.self.revokeSession(req.customer, sid);
    if (result.current) {
      const domain = this.config.platform.COOKIE_DOMAIN_PLATFORM;
      const options = { path: "/", ...(domain ? { domain } : {}) };
      res.clearCookie(SID_COOKIE_NAME.tenant, options);
      res.clearCookie(HINT_COOKIE_NAME, options);
    }
    return result;
  }
}
