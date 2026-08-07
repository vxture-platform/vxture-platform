/**
 * social.controller.ts — inbound-broker social login HTTP surface.
 * @package @vxture/bff-auth
 *
 * GET /auth/oauth/:provider/start    — begin login, 302 to the upstream provider.
 * GET /auth/oauth/:provider/callback — upstream return; on success set the central
 *   session cookie + 302 to the RP (with the auth code), or 302 to the accounts
 *   bind-phone page when the upstream returned no phone.
 * The registered redirect_uri (identity.oauth_provider) must point at the callback.
 * See docs/design/identity-platform-account.md §5.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { extractClientIp } from "@vxture/core-utils";
import { VxConfigService } from "@vxture/core-config";
import { buildSidCookie, buildHintCookie } from "../authn/cookie";
import { SocialAuthService } from "./social-auth.service";

@Controller("auth/oauth")
export class SocialController {
  constructor(
    @Inject(SocialAuthService) private readonly social: SocialAuthService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** Enabled providers for the login surface (code + display name; no secrets). */
  @Get("providers")
  async providers(): Promise<{ providers: { code: string; name: string }[] }> {
    return { providers: await this.social.listEnabledProviders() };
  }

  @Get(":provider/start")
  async start(
    @Param("provider") provider: string,
    @Query("login_challenge") loginChallenge: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!loginChallenge) {
      throw new BadRequestException("login_challenge required");
    }
    res.redirect(await this.social.buildStartUrl(provider, loginChallenge));
  }

  @Get(":provider/callback")
  async callback(
    @Param("provider") provider: string,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const loginBase = this.config.platform.LOGIN_UI_BASE_URL;
    // Upstream denial / error: send the user back to the login surface to retry.
    if (error) {
      res.redirect(new URL("/login", loginBase).toString());
      return;
    }
    if (!code || !state) {
      throw new BadRequestException("invalid_request");
    }

    const clientIp = extractClientIp(req);
    const userAgent = resolveUserAgent(req);
    const result = await this.social.handleCallback(
      provider,
      code,
      state,
      clientIp,
      userAgent,
    );
    if (result.kind === "login") {
      this.setSessionCookie(res, result.completion);
      res.redirect(result.completion.redirectTo);
      return;
    }

    // No upstream phone → bind-phone page on the accounts surface.
    const url = new URL("/bind-phone", loginBase);
    url.searchParams.set("binding_token", result.bindToken);
    res.redirect(url.toString());
  }

  /**
   * Complete a pending social→phone binding (no-phone upstreams, e.g. Google):
   * verify the SMS code, resolve/create the account by phone, link the identity,
   * set the central session cookie, and return the RP redirect for the SPA to
   * navigate to. 400 on a missing field / bad token, 401 on a wrong code.
   */
  @Post("bind-phone")
  @HttpCode(HttpStatus.OK)
  async bindPhone(
    @Body() body: { binding_token?: string; phone?: string; code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string }> {
    if (!body.binding_token || !body.phone || !body.code) {
      throw new BadRequestException("invalid_request");
    }
    const clientIp = extractClientIp(req);
    const userAgent = resolveUserAgent(req);
    const completion = await this.social.completeBind(
      body.binding_token,
      body.phone,
      body.code,
      clientIp,
      userAgent,
    );
    this.setSessionCookie(res, completion);
    return { redirectTo: completion.redirectTo };
  }

  /** Set the tenant central-session cookie (shares .vxture.com; mirrors oidc.router). */
  private setSessionCookie(
    res: Response,
    completion: { sid: string; realm: string; sessionMaxAge: number },
  ): void {
    const cookie = buildSidCookie({
      sid: completion.sid,
      realm: completion.realm === "workforce" ? "workforce" : "customer",
      maxAgeSeconds: completion.sessionMaxAge,
      platformCookieDomain: this.config.platform.COOKIE_DOMAIN_PLATFORM ?? null,
    });
    res.cookie(cookie.name, cookie.value, cookie.options);
    // Tenant realm: mirror oidc.router — set the JS-readable login-state hint.
    if (completion.realm !== "workforce") {
      const hint = buildHintCookie({
        maxAgeSeconds: completion.sessionMaxAge,
        platformCookieDomain:
          this.config.platform.COOKIE_DOMAIN_PLATFORM ?? null,
      });
      res.cookie(hint.name, hint.value, hint.options);
    }
  }
}

/** The request User-Agent, truncated defensively (login-attempt audit). Mirrors oidc.router. */
function resolveUserAgent(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua ? ua.slice(0, 512) : undefined;
}
