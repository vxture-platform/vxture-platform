/**
 * oidc.router.ts - OIDC IdP endpoints
 * @package @vxture/bff-auth
 * @description
 *   The platform-as-IdP OIDC endpoints. P0-5a: discovery + JWKS (live).
 *   authorize/token/userinfo/revoke/end_session land in subsequent P0-5 slices.
 *   See docs/design/identity-platform-idp.md §5/§11.
 *
 *   Paths are served relative to the auth-bff origin; the discovery document
 *   advertises ${OIDC_ISSUER}/oidc/* — nginx must route those public paths here.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { extractClientIp } from "@vxture/core-utils";
import { VxConfigService } from "@vxture/core-config";
import type { OidcClientInfo } from "@vxture/service-iam";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  OidcService,
  type OidcClientCredentials,
  type OidcMfaChallenge,
  type OidcTokenResponse,
  type OidcTokenExchangeResponse,
} from "../oidc/oidc.service";
import { TOKEN_EXCHANGE_GRANT_TYPE } from "../oidc/token-exchange.service";
import type { OidcJwk } from "../oidc/oidc-key.service";
import {
  buildSidCookie,
  buildHintCookie,
  SID_COOKIE_NAME as SID_COOKIE,
  HINT_COOKIE_NAME,
} from "../authn/cookie";

/** Raw form fields accepted at the token endpoint. */
interface TokenRequestBody {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
  scope?: string;
  client_id?: string;
  client_secret?: string;
  // token-exchange grant (RFC 8693, T1, product_210 §3.2). `subject_token`
  // present = OBO mode; absent = service mode (requires `workspace_id`).
  subject_token?: string;
  audience?: string;
  workspace_id?: string;
  org_id?: string;
}

@Controller()
export class OidcRouter {
  constructor(
    @Inject(OidcService) private readonly oidc: OidcService,
    @Inject(VxConfigService) private readonly config: VxConfigService,
  ) {}

  /** OIDC discovery document. */
  @Get(".well-known/openid-configuration")
  discovery(): Record<string, unknown> {
    return this.oidc.buildDiscoveryDocument();
  }

  /**
   * Authorization endpoint. Validates the request, then either 302s to the
   * client's redirect_uri (success code / OIDC error) or 302s to the IdP login
   * UI carrying a login_challenge when interactive login is required.
   */
  @Get("oidc/authorize")
  async authorize(
    @Query() q: Record<string, string | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!q.client_id || !q.redirect_uri || !q.scope || !q.code_challenge) {
      throw new BadRequestException("invalid_request");
    }
    // The realm of the requested client decides which session cookie to read.
    // The router cannot know that realm without a client lookup, so it hands
    // BOTH candidates to the service and the service — which has the client —
    // picks.
    //
    // This used to be `tenant ?? operator`, which only falls through when the
    // tenant cookie is ABSENT. A browser holding both (anyone who has also
    // signed into console or the website) therefore had its operator session
    // shadowed: the tenant sid was looked up, its realm did not match a
    // workforce client, and the operator was sent to a full login — with the
    // operator cookie sitting right there. Admin and opera each forced a fresh
    // login, MFA included, and each shadowed the other.
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const sids = {
      tenant: cookies[SID_COOKIE.tenant],
      operator: cookies[SID_COOKIE.operator],
    };

    const result = await this.oidc.authorize(
      {
        responseType: q.response_type ?? "",
        clientId: q.client_id,
        redirectUri: q.redirect_uri,
        scope: q.scope,
        state: q.state,
        codeChallenge: q.code_challenge,
        codeChallengeMethod: q.code_challenge_method ?? "",
        nonce: q.nonce,
        prompt: q.prompt,
        tenantHint: q.tenant_hint,
      },
      sids,
    );

    if (result.kind === "redirect") {
      res.redirect(result.location);
      return;
    }
    // Interactive login: hand off to the accounts login UI with the challenge.
    // Decoupled from any one app onto the neutral identity surface (prod:
    // accounts.vxture.com, same-origin with these OIDC endpoints).
    // See docs/design/identity-platform-idp.md.
    const loginBase = this.config.platform.LOGIN_UI_BASE_URL;
    const loginUrl = new URL("/login", loginBase);
    loginUrl.searchParams.set("login_challenge", result.loginChallenge);
    loginUrl.searchParams.set("realm", result.realm);
    res.redirect(loginUrl.toString());
  }

  /**
   * Cross-tab session-resume probe. The accounts login page polls this on
   * visibilitychange/focus: if a vx_sid cookie is present and the parked
   * challenge is still valid, the challenge is atomically consumed and this
   * returns { redirectTo } so the tab can complete the OIDC flow without
   * requiring the user to log in again. Returns 204 when no session exists yet.
   */
  @Get("oidc/authorize/resume")
  async resume(
    @Query("login_challenge") loginChallenge: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!loginChallenge) {
      res.status(400).json({ code: "INVALID_REQUEST" });
      return;
    }
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    /* 同 /authorize：两个都取，由下游按 realm 挑。 */
    const sid = cookies[SID_COOKIE.operator] ?? cookies[SID_COOKIE.tenant];
    if (!sid) {
      res.status(204).end();
      return;
    }
    const redirectTo = await this.oidc.resumeWithExistingSession(
      loginChallenge,
      sid,
    );
    if (!redirectTo) {
      res.status(204).end();
      return;
    }
    res.json({ redirectTo });
  }

  /** JWKS — RP signature verification (active + rotating public keys). */
  @Get("oidc/jwks")
  async jwks(): Promise<{ keys: OidcJwk[] }> {
    return this.oidc.getJwks();
  }

  /**
   * Public client branding (name / display_name / logo_url) for the login and
   * post-logout surfaces. No secrets; only enabled clients. See D-AU / D-AX.
   */
  @Get("oidc/client-info")
  async clientInfo(
    @Query("client_id") clientId?: string,
  ): Promise<OidcClientInfo> {
    if (!clientId) throw new BadRequestException("client_id required");
    const info = await this.oidc.getClientInfo(clientId);
    if (!info) throw new NotFoundException("unknown_client");
    return info;
  }

  /** UserInfo — Bearer access_token → profile claims. */
  @Get("oidc/userinfo")
  async userinfo(
    @Headers("authorization") authorization?: string,
  ): Promise<Record<string, unknown>> {
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : null;
    if (!token) {
      throw new UnauthorizedException("invalid_token");
    }
    return this.oidc.userinfo(token);
  }

  /** Token revocation (RFC 7009) — always 200. */
  @Post("oidc/revoke")
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Body() body: { token?: string; token_type_hint?: string },
  ): Promise<void> {
    if (body.token) {
      await this.oidc.revoke(body.token, body.token_type_hint);
    }
  }

  /** End session — destroy central session, back-channel logout, redirect. */
  @Get("oidc/end_session")
  async endSession(
    @Query() q: Record<string, string | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    /**
     * **两个 realm 的会话都结束**，不是二选一。
     *
     * 这个端点下面本来就把两个 realm 的 cookie 连同 hint 一起清掉——只销毁其中一个
     * 服务端会话，等于清了浏览器的凭证却把服务端会话留成孤儿。此前的
     * `tenant ?? operator` 更糟：浏览器同时持有两份时，它销毁租户会话、**把运营者
     * 会话留着**，于是运营者点了登出、cookie 也清了，下一次 authorize 又被静默 SSO
     * 送回登录态——表现就是"退不出去"。
     */
    const redirect = await this.oidc.endSession(
      [cookies[SID_COOKIE.operator], cookies[SID_COOKIE.tenant]],
      q.post_logout_redirect_uri,
      q.state,
    );

    // Clear both realm session cookies (host + parent domain variants).
    const cookieDomain = this.config.platform.COOKIE_DOMAIN_PLATFORM;
    res.clearCookie(SID_COOKIE.operator, { path: "/" });
    res.clearCookie(SID_COOKIE.tenant, {
      path: "/",
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
    // Clear the JS-readable login-state hint alongside the tenant session.
    res.clearCookie(HINT_COOKIE_NAME, {
      path: "/",
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });

    if (redirect) {
      res.redirect(redirect);
      return;
    }
    /**
     * 没有可信任的回跳地址时，落到 IdP 自己的登出页——**不是 204**。
     *
     * 这个端点是用**顶层导航**到达的（accounts 域的会话 cookie 是 SameSite=Lax，
     * 只有顶层导航带得上它）。浏览器收到 204 会停在原页一动不动：会话其实已经结束，
     * 用户看到的却是"点了登出没反应"——和登出坏掉时一模一样。一个专门用来结束会话
     * 的端点，最不该做的就是让成功看起来像失败。
     *
     * 走到这里有两种情形，都该看到同一个页面：调用方没给 post_logout_redirect_uri，
     * 或者给的地址不在该会话任何 client 的登记里。防开放重定向的判断一点没放松——
     * 不受信任的地址依旧不跳，只是改跳我们自己的页面。
     */
    const logoutUrl = new URL(
      "/logout",
      this.config.platform.LOGIN_UI_BASE_URL,
    );
    res.redirect(logoutUrl.toString());
  }

  /**
   * Interactive login completion (password). The IdP login UI POSTs the
   * login_challenge + credentials. Tenant logins (and operator logins owing no
   * second factor) set a central-session cookie and return the client redirect
   * with the authorization code. An operator owing a second factor returns an
   * `mfa_required` continuation instead — no cookie — to be completed at
   * /oidc/authorize/mfa/verify (identity-platform-operator.md §3.2).
   */
  @Post("oidc/authorize/login")
  @HttpCode(HttpStatus.OK)
  async authorizeLogin(
    @Body()
    body: {
      login_challenge?: string;
      identifier?: string;
      password?: string;
      turnstile_token?: string;
    },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string } | OidcMfaChallenge> {
    if (!body.login_challenge || !body.identifier || !body.password) {
      throw new BadRequestException("invalid_request");
    }
    const result = await this.oidc.completeLoginWithPassword({
      loginChallenge: body.login_challenge,
      identifier: body.identifier,
      password: body.password,
      turnstileToken: body.turnstile_token,
      clientIp: extractClientIp(req),
      userAgent: resolveUserAgent(req),
    });
    if ("status" in result) {
      // MFA continuation: no session established yet.
      return result;
    }
    this.setSessionCookie(res, result);
    return { redirectTo: result.redirectTo };
  }

  /**
   * Step2 of operator login — verify the second factor against a pending MFA
   * challenge. On success the operator central-session cookie is set and the
   * client redirect (with code) is returned. See identity-platform-operator.md
   * §3.2. Operator realm only.
   */
  @Post("oidc/authorize/mfa/verify")
  @HttpCode(HttpStatus.OK)
  async authorizeMfaVerify(
    @Body()
    body: { mfa_token?: string; method?: string; code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string }> {
    if (!body.mfa_token || !body.method) {
      throw new BadRequestException("invalid_request");
    }
    const completion = await this.oidc.completeOperatorMfa({
      mfaToken: body.mfa_token,
      method: body.method,
      code: body.code ?? "",
      clientIp: extractClientIp(req),
      userAgent: resolveUserAgent(req),
    });
    this.setSessionCookie(res, completion);
    return { redirectTo: completion.redirectTo };
  }

  /**
   * Step2 (WebAuthn) — begin: assertion options for the pending operator's
   * registered passkeys (challenge parked server-side). No session. Operator
   * realm only. See identity-platform-operator.md §3.2.
   */
  @Post("oidc/authorize/mfa/webauthn/options")
  @HttpCode(HttpStatus.OK)
  async authorizeMfaWebauthnOptions(
    @Body() body: { mfa_token?: string },
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    if (!body.mfa_token) {
      throw new BadRequestException("invalid_request");
    }
    return this.oidc.beginOperatorWebauthnAuth(body.mfa_token);
  }

  /**
   * Step2 (WebAuthn) — verify the assertion. On success the operator
   * central-session cookie is set and the client redirect (with code) is
   * returned. Operator realm only.
   */
  @Post("oidc/authorize/mfa/webauthn/verify")
  @HttpCode(HttpStatus.OK)
  async authorizeMfaWebauthnVerify(
    @Body() body: { mfa_token?: string; response?: AuthenticationResponseJSON },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string }> {
    if (!body.mfa_token || !body.response) {
      throw new BadRequestException("invalid_request");
    }
    const completion = await this.oidc.completeOperatorWebauthn({
      mfaToken: body.mfa_token,
      response: body.response,
      clientIp: extractClientIp(req),
      userAgent: resolveUserAgent(req),
    });
    this.setSessionCookie(res, completion);
    return { redirectTo: completion.redirectTo };
  }

  /**
   * Enroll-on-login (WebAuthn) — begin: registration options for the pending
   * high-privilege operator's first passkey (§2.1 bootstrap). No session.
   */
  @Post("oidc/authorize/mfa/enroll/webauthn/options")
  @HttpCode(HttpStatus.OK)
  async authorizeMfaEnrollWebauthnOptions(
    @Body() body: { mfa_token?: string },
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    if (!body.mfa_token) {
      throw new BadRequestException("invalid_request");
    }
    return this.oidc.beginOperatorWebauthnEnrollment(body.mfa_token);
  }

  /**
   * Enroll-on-login (WebAuthn) — verify: a verified registration completes the
   * login (session cookie + client redirect with code). Operator realm only.
   */
  @Post("oidc/authorize/mfa/enroll/webauthn/verify")
  @HttpCode(HttpStatus.OK)
  async authorizeMfaEnrollWebauthnVerify(
    @Body() body: { mfa_token?: string; response?: RegistrationResponseJSON },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string }> {
    if (!body.mfa_token || !body.response) {
      throw new BadRequestException("invalid_request");
    }
    const completion = await this.oidc.confirmOperatorWebauthnEnrollment({
      mfaToken: body.mfa_token,
      response: body.response,
      clientIp: extractClientIp(req),
      userAgent: resolveUserAgent(req),
    });
    this.setSessionCookie(res, completion);
    return { redirectTo: completion.redirectTo };
  }

  /**
   * Enroll-on-login (TOTP) — begin. Stages a fresh secret for the pending
   * operator and returns the base32 secret + otpauth URI for the QR. No session
   * is established. Operator realm only. See identity-platform-operator.md §3.2.
   */
  @Post("oidc/authorize/mfa/enroll/totp")
  @HttpCode(HttpStatus.OK)
  async authorizeMfaEnrollTotp(
    @Body() body: { mfa_token?: string },
  ): Promise<{ secret: string; otpauthUri: string }> {
    if (!body.mfa_token) {
      throw new BadRequestException("invalid_request");
    }
    return this.oidc.beginOperatorTotpEnrollment(body.mfa_token);
  }

  /**
   * Enroll-on-login (TOTP) — confirm. The first valid code enables TOTP and
   * completes the login (session cookie + client redirect with code). Operator
   * realm only.
   */
  @Post("oidc/authorize/mfa/enroll/totp/confirm")
  @HttpCode(HttpStatus.OK)
  async authorizeMfaEnrollTotpConfirm(
    @Body() body: { mfa_token?: string; code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string; recoveryCodes: string[] }> {
    if (!body.mfa_token || !body.code) {
      throw new BadRequestException("invalid_request");
    }
    const completion = await this.oidc.confirmOperatorTotpEnrollment({
      mfaToken: body.mfa_token,
      code: body.code,
      clientIp: extractClientIp(req),
      userAgent: resolveUserAgent(req),
    });
    this.setSessionCookie(res, completion);
    // recoveryCodes are returned ONCE here for the UI to display.
    return {
      redirectTo: completion.redirectTo,
      recoveryCodes: completion.recoveryCodes,
    };
  }

  /**
   * Interactive login completion via phone code (tenant realm only). The login
   * UI POSTs the login_challenge + phone + SMS code; on success the central
   * session cookie is set and the client redirect (with code) is returned.
   */
  @Post("oidc/authorize/login/phone")
  @HttpCode(HttpStatus.OK)
  async authorizeLoginPhone(
    @Body()
    body: { login_challenge?: string; phone?: string; code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string }> {
    if (!body.login_challenge || !body.phone || !body.code) {
      throw new BadRequestException("invalid_request");
    }
    const completion = await this.oidc.completeLoginWithPhone({
      loginChallenge: body.login_challenge,
      phone: body.phone,
      code: body.code,
      clientIp: extractClientIp(req),
      userAgent: resolveUserAgent(req),
    });
    this.setSessionCookie(res, completion);
    return { redirectTo: completion.redirectTo };
  }

  /**
   * Interactive login completion via email code (tenant realm only, login-only).
   * The login UI POSTs the login_challenge + email + code; on success the central
   * session cookie is set and the client redirect (with code) is returned.
   */
  @Post("oidc/authorize/login/email")
  @HttpCode(HttpStatus.OK)
  async authorizeLoginEmail(
    @Body()
    body: { login_challenge?: string; email?: string; code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ redirectTo: string }> {
    if (!body.login_challenge || !body.email || !body.code) {
      throw new BadRequestException("invalid_request");
    }
    const completion = await this.oidc.completeLoginWithEmail({
      loginChallenge: body.login_challenge,
      email: body.email,
      code: body.code,
      clientIp: extractClientIp(req),
      userAgent: resolveUserAgent(req),
    });
    this.setSessionCookie(res, completion);
    return { redirectTo: completion.redirectTo };
  }

  /** Set the realm central-session cookie (tenant shares .vxture.com; operator host-only, D-7). */
  private setSessionCookie(
    res: Response,
    completion: { sid: string; realm: string; sessionMaxAge: number },
  ): void {
    const secure = process.env["IDP_COOKIE_INSECURE"] !== "true";
    const cookie = buildSidCookie({
      sid: completion.sid,
      realm: completion.realm === "workforce" ? "workforce" : "customer",
      maxAgeSeconds: completion.sessionMaxAge,
      platformCookieDomain: this.config.platform.COOKIE_DOMAIN_PLATFORM ?? null,
      secure,
    });
    res.cookie(cookie.name, cookie.value, cookie.options);
    // Tenant realm: also drop the JS-readable login-state hint so the marketing
    // website can skip the prompt=none bounce for anonymous visitors.
    if (completion.realm !== "workforce") {
      const hint = buildHintCookie({
        maxAgeSeconds: completion.sessionMaxAge,
        platformCookieDomain:
          this.config.platform.COOKIE_DOMAIN_PLATFORM ?? null,
        secure,
      });
      res.cookie(hint.name, hint.value, hint.options);
    }
  }

  /** Token endpoint — authorization_code + refresh_token + token-exchange grants (confidential client). */
  @Post("oidc/token")
  @HttpCode(HttpStatus.OK)
  async token(
    @Body() body: TokenRequestBody,
    @Headers("authorization") authorization?: string,
  ): Promise<OidcTokenResponse | OidcTokenExchangeResponse> {
    const creds = resolveClientCredentials(body, authorization);

    switch (body.grant_type) {
      case "authorization_code": {
        if (!body.code || !body.redirect_uri || !body.code_verifier) {
          throw new BadRequestException("invalid_request");
        }
        return this.oidc.tokenWithAuthCode(creds, {
          code: body.code,
          redirectUri: body.redirect_uri,
          codeVerifier: body.code_verifier,
        });
      }
      case "refresh_token": {
        if (!body.refresh_token) {
          throw new BadRequestException("invalid_request");
        }
        return this.oidc.tokenWithRefresh(creds, {
          refreshToken: body.refresh_token,
          scope: body.scope,
        });
      }
      case TOKEN_EXCHANGE_GRANT_TYPE: {
        return this.oidc.tokenExchange(creds, {
          audience: body.audience,
          subjectToken: body.subject_token,
          workspaceId: body.workspace_id,
          orgId: body.org_id,
        });
      }
      default:
        throw new BadRequestException("unsupported_grant_type");
    }
  }
}

/** The request User-Agent, truncated defensively (operator audit). */
function resolveUserAgent(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" && ua ? ua.slice(0, 512) : undefined;
}

/**
 * Resolve client credentials from `client_secret_basic` (Authorization: Basic)
 * or `client_secret_post` (form body). Basic takes precedence per RFC 6749.
 */
function resolveClientCredentials(
  body: TokenRequestBody,
  authorization?: string,
): OidcClientCredentials {
  if (authorization?.startsWith("Basic ")) {
    const decoded = Buffer.from(
      authorization.slice("Basic ".length),
      "base64",
    ).toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep > 0) {
      return {
        clientId: decodeURIComponent(decoded.slice(0, sep)),
        clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
      };
    }
  }
  if (body.client_id && body.client_secret) {
    return { clientId: body.client_id, clientSecret: body.client_secret };
  }
  throw new BadRequestException("invalid_client");
}
