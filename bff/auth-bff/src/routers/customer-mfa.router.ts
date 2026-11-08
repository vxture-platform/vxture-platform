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
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CustomerSelfGuard,
  type CustomerSelfRequest,
} from "../authn/customer-self.guard";
import { CustomerSecurityChallengeService } from "../authn/customer-security-challenge.service";
import { CustomerMfaService } from "../oidc/customer-mfa.service";

@Controller("oidc/customer/self/mfa")
@UseGuards(CustomerSelfGuard)
export class CustomerMfaRouter {
  constructor(
    @Inject(CustomerMfaService) private readonly mfa: CustomerMfaService,
    @Inject(CustomerSecurityChallengeService)
    private readonly challenges: CustomerSecurityChallengeService,
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  async status(@Req() req: CustomerSelfRequest) {
    return { enabled: await this.mfa.enabled(req.customer.userId) };
  }

  @Post("challenges")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  start(@Req() req: CustomerSelfRequest) {
    return this.challenges.start(req.customer, "mfa-enable", "", "phone");
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
}
