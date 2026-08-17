/**
 * operator-stepup.router.ts — internal IdP endpoint for operator step-up (P4.2).
 * @package @vxture/bff-auth
 *
 * Server-to-server only (InternalAuthGuard / AUTH_INTERNAL_TOKEN): admin-bff
 * forwards an authenticated operator's TOTP code here; the IdP verifies it and
 * mints a short-lived step-up credential. Not part of the public /oidc/* surface
 * — nginx must not expose /internal/*. The operatorId is supplied by the trusted
 * caller (derived from the RP session), never from a browser.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { extractClientIp } from "@vxture/core-utils";
import { OidcService } from "../oidc/oidc.service";
import { InternalAuthGuard } from "../authn/internal-auth.guard";

@Controller()
@UseGuards(InternalAuthGuard)
export class OperatorStepUpRouter {
  constructor(@Inject(OidcService) private readonly oidc: OidcService) {}

  /** Verify TOTP for an authenticated operator → short-lived step-up credential. */
  @Post("internal/operator/stepup/totp")
  @HttpCode(HttpStatus.OK)
  async totp(
    @Body() body: { operatorId?: string; code?: string; audience?: string },
    @Req() req: Request,
    @Headers("user-agent") userAgent?: string,
  ): Promise<{ stepUpToken: string; expiresIn: number }> {
    if (!body.operatorId || !body.code) {
      throw new BadRequestException("invalid_request");
    }
    const result = await this.oidc.issueOperatorStepUp({
      operatorId: body.operatorId,
      method: "totp",
      code: body.code,
      ip: extractClientIp(req),
      userAgent,
      /* 缺省 admin（见 issueOperatorStepUp 的参数注释）：老调用方不传也不变。 */
      ...(body.audience ? { audience: body.audience } : {}),
    });
    if (!result) {
      throw new UnauthorizedException("invalid_mfa_code");
    }
    return result;
  }
}
