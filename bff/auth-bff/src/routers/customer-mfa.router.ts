/**
 * customer-mfa.router.ts - phone-proven optional customer MFA enrollment.
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-08
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
// ⚠️ Cross-layer reference: use public account/config APIs for realm-owned cleanup.
import { AccountService } from "@vxture/service-account";
import { VxConfigService } from "@vxture/core-config";
import {
  CustomerSelfGuard,
  type CustomerSelfRequest,
} from "../authn/customer-self.guard";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import { CustomerMfaService } from "../oidc/customer-mfa.service";
import { OidcService } from "../oidc/oidc.service";
import { SID_COOKIE_NAME, HINT_COOKIE_NAME } from "../authn/cookie";

// ============================================================================
// Customer factor lifecycle
// ============================================================================

@Controller("oidc/customer/self/mfa")
@UseGuards(CustomerSelfGuard)
export class CustomerMfaRouter {
  private readonly logger = new Logger(CustomerMfaRouter.name);
  constructor(
    @Inject(CustomerMfaService) private readonly mfa: CustomerMfaService,
    @Inject(CustomerSecurityChallengeService)
    private readonly challenges: CustomerSecurityChallengeService,
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  async status(@Req() req: CustomerSelfRequest) {
    return { enabled: await this.mfa.enabled(req.customer.userId) };
  }

  @Post("challenges")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  start(
    @Req() req: CustomerSelfRequest,
    @Body() body: { proofToken?: unknown },
  ) {
    return this.challenges.startAuthorized(
      req.customer,
      "mfa-enable",
      "",
      body?.proofToken,
    );
  }

  @Post("enroll")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async enroll(
    @Req() req: CustomerSelfRequest,
    @Body() body: { challengeId?: unknown },
  ) {
    if (typeof body?.challengeId !== "string")
      throw new BadRequestException("invalid_request");
    await this.challenges.consume(req.customer, body.challengeId, "mfa-enable");
    return this.mfa.beginEnrollment(
      req.customer.userId,
      req.customer.sid,
      req.customer.user.account,
    );
  }

  @Post("confirm")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  confirm(
    @Req() req: CustomerSelfRequest,
    @Body() body: { enrollmentToken?: unknown; code?: unknown },
  ) {
    if (
      typeof body?.enrollmentToken !== "string" ||
      typeof body.code !== "string"
    )
      throw new BadRequestException("invalid_request");
    return this.mfa.confirmEnrollment(
      req.customer.userId,
      req.customer.sid,
      body.enrollmentToken,
      body.code,
    );
  }

  /**
   * Remove a customer factor only after a fresh factor proof, then propagate logout.
   * @param req - Guard-owned customer session; workforce cookies never select the account.
   * @param body - TOTP or recovery proof, without an account identifier.
   * @param res - Clears only customer session/hint cookies after durable success.
   * @returns Durable success even if best-effort back-channel delivery is unavailable.
   * @throws {BadRequestException} For malformed or rejected factor proof.
   */
  @Post("disable")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async disable(
    @Req() req: CustomerSelfRequest,
    @Body() body: { method?: unknown; code?: unknown },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (
      !["totp", "recovery"].includes(
        typeof body?.method === "string" ? body.method : "",
      ) ||
      typeof body?.code !== "string" ||
      !body.code.trim() ||
      body.code.length > 128
    )
      throw new BadRequestException("invalid_request");
    const sessions = await this.accounts.listSessions(req.customer.userId);
    const result = await this.mfa.disable(
      req.customer.userId,
      req.customer.sid,
      body.method as string,
      body.code.trim(),
    );
    const domain = this.config.platform.COOKIE_DOMAIN_PLATFORM;
    const options = { path: "/", ...(domain ? { domain } : {}) };
    res.clearCookie(SID_COOKIE_NAME.tenant, options);
    res.clearCookie(HINT_COOKIE_NAME, options);
    try {
      await this.oidc.cleanupCustomerSessions(
        req.customer.userId,
        sessions.map((session) => session.sid),
      );
      return { ...result, logoutPropagationPending: false };
    } catch {
      this.logger.warn(
        `customer MFA logout propagation incomplete: ${req.customer.userId}`,
      );
      return { ...result, logoutPropagationPending: true };
    }
  }
}
