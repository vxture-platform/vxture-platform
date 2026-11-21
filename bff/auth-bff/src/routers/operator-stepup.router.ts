/**
 * operator-stepup.router.ts — internal IdP endpoint for operator step-up (P4.2).
 * @package @vxture/bff-auth
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-20
 *
 * Server-to-server only (InternalAuthGuard / IDP_INTERNAL_TOKEN, the IdP internal-face key
 * since 2026-10-04; the product-face AUTH_INTERNAL_TOKEN gets 401 here): admin-bff
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
// ⚠️ 跨层引用: Resolve proxy-aware client IP through the public infrastructure API.
import { extractClientIp } from "@vxture/core-utils";
import { OidcService, type OperatorStepUpAction } from "../oidc/oidc.service";
import { InternalAuthGuard } from "../authn/internal-auth.guard";
import { InternalRoute } from "../authn/internal-route-policy";

// ============================================================================
// Internal issuance and one-time action consumption
// ============================================================================
@Controller()
@UseGuards(InternalAuthGuard)
export class OperatorStepUpRouter {
  constructor(@Inject(OidcService) private readonly oidc: OidcService) {}

  /** Verify TOTP for an authenticated operator → short-lived step-up credential. */
  @InternalRoute({
    risk: "credential-mint",
    actor: "proven",
    why: "Trusted operator RPs exchange the authenticated operator's TOTP proof for a short-lived credential.",
  })
  @Post("internal/operator/stepup/totp")
  @HttpCode(HttpStatus.OK)
  async totp(
    @Body()
    body: {
      operatorId?: string;
      code?: string;
      audience?: string;
      action?: OperatorStepUpAction;
    },
    @Req() req: Request,
    @Headers("user-agent") userAgent?: string,
  ): Promise<{ stepUpToken: string; expiresIn: number }> {
    if (!body || typeof body !== "object" || !body.operatorId || !body.code) {
      throw new BadRequestException("invalid_request");
    }
    const result = await this.oidc.issueOperatorStepUp({
      operatorId: body.operatorId,
      method: "totp",
      code: body.code,
      ...(body.action !== undefined ? { action: body.action } : {}),
      ip: extractClientIp(req),
      userAgent,
      // Existing callers that omit the audience retain the admin default.
      ...(body.audience !== undefined ? { audience: body.audience } : {}),
    });
    if (!result) {
      throw new UnauthorizedException("invalid_mfa_code");
    }
    return result;
  }

  /** Consume a signed proof; its operator and request bindings are verified again. */
  @InternalRoute({
    risk: "admin-action",
    actor: "proven",
    why: "The RP presents an IdP-signed action proof bound to its authenticated operator and session; consumption grants one execution or receipt replay only.",
  })
  @Post("internal/operator/stepup/consume")
  @HttpCode(HttpStatus.OK)
  async consume(
    @Body()
    body: {
      operatorId: string;
      stepUpToken: string;
      audience: string;
      action: OperatorStepUpAction;
    },
  ): Promise<{ mode: "execute" | "replay" }> {
    if (!body || typeof body !== "object")
      throw new BadRequestException("invalid_request");
    return this.oidc.consumeOperatorStepUp(body);
  }
}
