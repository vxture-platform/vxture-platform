/**
 * accounts-login.router.ts - first-party login intent initiation.
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
  Header,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { OidcService } from "../oidc/oidc.service";
import { RedisService } from "../redis/redis.service";
import { AccountsOriginGuard } from "../accounts/accounts-origin.guard";
// ⚠️ Cross-layer reference: use the public request IP normalizer.
import { extractClientIp } from "@vxture/core-utils";

@Controller("oidc/accounts")
export class AccountsLoginRouter {
  constructor(
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AccountsOriginGuard) private readonly origin: AccountsOriginGuard,
  ) {}

  /** No caller-controlled redirect, OAuth scopes, subject or client is accepted. */
  @Post("login-context")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async start(@Req() req: Request, @Body() body: { realm?: unknown }) {
    this.origin.assertRequest(req);
    if (body?.realm !== "customer" && body?.realm !== "workforce")
      throw new BadRequestException("invalid_realm");
    if (
      !(await this.redis.reserveCaptchaVerification(
        `accounts-login:${extractClientIp(req)}`,
      ))
    )
      throw new HttpException("too_many_attempts", 429);
    return this.oidc.beginAccountsLogin(body.realm);
  }
  @Post("workforce/send-code")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async sendWorkforce(
    @Req() req: Request,
    @Body()
    body: { login_challenge?: string; phone?: string; captcha_token?: string },
  ) {
    this.origin.assertRequest(req);
    if (
      typeof body?.login_challenge !== "string" ||
      !body.login_challenge ||
      typeof body.phone !== "string" ||
      !body.phone ||
      (body.captcha_token !== undefined &&
        typeof body.captcha_token !== "string")
    )
      throw new BadRequestException("invalid_request");
    return this.oidc.sendWorkforceLoginCode({
      loginChallenge: body.login_challenge,
      phone: body.phone,
      ...(body.captcha_token ? { captchaToken: body.captcha_token } : {}),
      clientIp: extractClientIp(req),
    });
  }
}
