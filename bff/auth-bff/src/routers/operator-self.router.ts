/**
 * Workforce account-center endpoints using the operator central session cookie.
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
  HttpCode,
  Header,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  OperatorSelfService,
  type OperatorSelfView,
} from "../oidc/operator-self.service";
import { OperatorSelfGuard } from "../authn/operator-self.guard";
import { SID_COOKIE_NAME as SID_COOKIE } from "../authn/cookie";

// ============================================================================
// Workforce account self-service
// ============================================================================

@Controller()
@UseGuards(OperatorSelfGuard)
export class OperatorSelfRouter {
  constructor(
    @Inject(OperatorSelfService)
    private readonly self: OperatorSelfService,
  ) {}

  /** Read the authenticated operator's own account view. */
  @Get("oidc/operator/self")
  @Header("Cache-Control", "no-store")
  async getSelf(@Req() req: Request): Promise<OperatorSelfView> {
    return this.self.getSelf(operatorSid(req));
  }

  /** Email change — step 1: send a code to the new address. */
  @Post("oidc/operator/self/email/start")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async startEmail(
    @Body() body: { newEmail?: string },
    @Req() req: Request,
  ): Promise<{ ok: true; sentTo: string }> {
    return this.self.startEmailChange(operatorSid(req), body?.newEmail);
  }

  /** Email change — step 2: verify the code, write the new email. */
  @Post("oidc/operator/self/email/verify")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() body: { code?: string },
    @Req() req: Request,
  ): Promise<{ ok: true; email: string }> {
    return this.self.verifyEmailChange(operatorSid(req), body?.code);
  }

  /** Phone change — step 1: send an SMS code to the new number. */
  @Post("oidc/operator/self/phone/start")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async startPhone(
    @Body() body: { newPhone?: string },
    @Req() req: Request,
  ): Promise<{ ok: true; sentTo: string }> {
    return this.self.startPhoneChange(operatorSid(req), body?.newPhone);
  }

  /** Phone change — step 2: verify the code, write the new phone. */
  @Post("oidc/operator/self/phone/verify")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async verifyPhone(
    @Body() body: { newPhone?: string; code?: string },
    @Req() req: Request,
  ): Promise<{ ok: true; phone: string }> {
    return this.self.verifyPhoneChange(
      operatorSid(req),
      body?.newPhone,
      body?.code,
    );
  }

  /** Password change ends all workforce sessions, then clears the host-only cookie. */
  @Post("oidc/operator/self/password")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() body: { currentPassword?: string; newPassword?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const result = await this.self.changePassword(
      operatorSid(req),
      body?.currentPassword,
      body?.newPassword,
    );
    res.clearCookie(SID_COOKIE.operator, { path: "/" });
    return result;
  }

  /** TOTP (re-)enroll — step 1: stage a new secret, return secret + otpauth URI. */
  @Post("oidc/operator/self/mfa/totp/start")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async startMfaTotp(
    @Body() body: { currentPassword?: unknown; currentCode?: unknown },
    @Req() req: Request,
  ): Promise<{ secret: string; otpauthUri: string; enrollmentToken: string }> {
    return this.self.startMfaTotp(
      operatorSid(req),
      body?.currentPassword,
      body?.currentCode,
    );
  }

  /** TOTP (re-)enroll — step 2: confirm the code, enable + return recovery codes. */
  @Post("oidc/operator/self/mfa/totp/confirm")
  @Header("Cache-Control", "no-store")
  @HttpCode(HttpStatus.OK)
  async confirmMfaTotp(
    @Body() body: { code?: string; enrollmentToken?: unknown },
    @Req() req: Request,
  ): Promise<{ ok: true; recoveryCodes: string[] }> {
    return this.self.confirmMfaTotp(
      operatorSid(req),
      body?.code,
      body?.enrollmentToken,
    );
  }
}

// ============================================================================
// Cookie selection
// ============================================================================

/** Read the operator central-session cookie from the request. */
function operatorSid(req: Request): string | undefined {
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
  return cookies[SID_COOKIE.operator];
}
