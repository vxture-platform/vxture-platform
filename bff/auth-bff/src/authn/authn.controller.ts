/**
 * authn.controller.ts — non-OIDC-protocol auth HTTP surface.
 * @package @vxture/bff-auth
 *
 * Registration (§13.1) and SMS-code issuance for phone-code login (§6.1). The
 * interactive login completions themselves live on the OIDC surface
 * (/oidc/authorize/login[/phone]); these endpoints feed those flows.
 */
import { validNewPassword } from "./password-policy";

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { extractClientIp } from "@vxture/core-utils";
import { CustomerPhoneCodeService } from "./customer-phone-code.service";
import { AuthnService } from "./authn.service";
import { TenantLoginGuard } from "./tenant-login-guard.service";

@Controller("auth")
export class AuthnController {
  constructor(
    @Inject(AuthnService) private readonly authn: AuthnService,
    @Inject(CustomerPhoneCodeService)
    private readonly phoneCode: CustomerPhoneCodeService,
    @Inject(TenantLoginGuard) private readonly tenantGuard: TenantLoginGuard,
  ) {}

  /**
   * Register a user (§13.1): creates the User (Argon2id when a password is given)
   * + a personal Org + default Workspace + owner membership at both levels.
   * Phone ownership must be verified before any account is created.
   */
  @Post("register")
  @HttpCode(HttpStatus.OK)
  async register(
    @Body()
    body: {
      account?: string;
      email?: string;
      phone?: string;
      code?: string;
      password?: string;
      name?: string;
    },
  ): Promise<{
    userId: string;
    account: string;
    orgId: string;
    workspaceId: string;
  }> {
    if (typeof body.phone !== "string" || !body.phone.trim()) {
      throw new BadRequestException("phone is required");
    }
    if (typeof body.code !== "string" || !body.code.trim()) {
      throw new BadRequestException("phone verification code is required");
    }
    if (body.password && !validNewPassword(body.password, "customer"))
      throw new BadRequestException("weak_password");
    const result = await this.authn.register({
      account: body.account ?? null,
      email: body.email ?? null,
      phone: body.phone,
      code: body.code,
      password: body.password ?? null,
      name: body.name ?? null,
    });
    return {
      userId: result.user.id,
      account: result.user.account,
      orgId: result.org.id,
      workspaceId: result.workspace.id,
    };
  }

  /**
   * Send a customer login code after consuming a one-time human-verification proof.
   */
  @Post("send-phone-code")
  @HttpCode(HttpStatus.OK)
  async sendPhoneCode(
    @Body() body: { phone?: string; captcha_token?: string },
    @Req() req: Request,
  ): Promise<{ sent: true }> {
    if (
      typeof body?.phone !== "string" ||
      !/^1[3-9]\d{9}$/.test(body.phone.trim())
    ) {
      throw new BadRequestException("phone is required");
    }
    await this.tenantGuard.verifyHuman(
      body.captcha_token,
      extractClientIp(req),
    );
    await this.phoneCode.sendCode(body.phone, { scope: "customer-login" });
    return { sent: true };
  }

  /** Issue an OTP exclusively for explicit customer registration. */
  @Post("register/send-phone-code")
  @HttpCode(HttpStatus.OK)
  async sendRegistrationCode(
    @Body() body: { phone?: string; captcha_token?: string },
    @Req() req: Request,
  ): Promise<{ sent: true }> {
    if (
      typeof body?.phone !== "string" ||
      !/^1[3-9]\d{9}$/.test(body.phone.trim())
    )
      throw new BadRequestException("invalid_phone");
    await this.tenantGuard.verifyHuman(
      body.captcha_token,
      extractClientIp(req),
    );
    await this.phoneCode.sendCode(body.phone, { scope: "customer-register" });
    return { sent: true };
  }

  /**
   * Send an email verification code for email-code login (D-CC). Same human-verification
   * gate as the SMS path, ahead of the per-email send rate-limit in
   * VerifyCodeService. Email-code login is login-only (D-CB) — issuing a code
   * here does not create an account.
   */
  @Post("send-email-code")
  @HttpCode(HttpStatus.OK)
  async sendEmailCode(
    @Body() body: { email?: string; captcha_token?: string },
    @Req() req: Request,
  ): Promise<{ sent: true }> {
    if (
      typeof body?.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
    ) {
      throw new BadRequestException("a valid email is required");
    }
    await this.tenantGuard.verifyHuman(
      body.captcha_token,
      extractClientIp(req),
    );
    await this.authn.sendEmailCode(body.email);
    return { sent: true };
  }

  /**
   * Request an email-link password reset (D-BE=A). Always returns 200 regardless
   * of whether the email maps to a user — the work (token issue + send) happens
   * only for a real account with an email, so the response can't reveal which
   * emails are registered.
   */
  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() body: { email?: string },
  ): Promise<{ ok: true }> {
    if (typeof body?.email !== "string" || !body.email.trim()) {
      throw new BadRequestException("a valid email is required");
    }
    await this.authn.requestPasswordReset(body.email);
    return { ok: true };
  }

  /**
   * Consume a reset token and set the new password. 400 on a missing field, a too
   * short password, or an unknown / expired / already-used token.
   */
  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: { token?: string; password?: string },
  ): Promise<{ ok: true }> {
    if (
      typeof body?.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.token) ||
      typeof body.password !== "string" ||
      !body.password
    ) {
      throw new BadRequestException("token and password are required");
    }
    if (!validNewPassword(body.password, "customer")) {
      throw new BadRequestException("weak_password");
    }
    const ok = await this.authn.resetPassword(body.token, body.password);
    if (!ok) throw new BadRequestException("invalid or expired token");
    return { ok: true };
  }
}
