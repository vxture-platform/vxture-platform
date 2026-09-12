/**
 * oidc-auth.router.ts - console RP auth endpoints (P1-e, additive)
 * @package @vxture/bff-console
 * @description
 *   /auth/* RP endpoints (outside api/*, so the legacy AuthMiddleware is not
 *   involved): login → IdP authorize, callback → token exchange + RP session,
 *   session lookup, local logout. Tokens stay server-side; the browser holds
 *   only the opaque __Host-vx_rp_session cookie. See identity-platform-rp-integration.md §2/§4.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  generatePkce,
  mapAccessClaims,
  randomToken,
  safeReturnTo,
  rpSessionCookieName,
  type OidcRpClient,
  type RpAuthService,
  type RpSession,
  type RpSessionStore,
} from "@vxture/core-oidc-rp";
import {
  anonymousPresenceCookie,
  clearPresenceCookie,
  presenceCookieName,
  resolveLoginPrompt,
  silentFailureReturnTo,
} from "@vxture/core-identity-sdk";
import type { Redis } from "ioredis";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_REDIS,
  RP_RUNTIME,
  RP_SESSION_STORE,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import { Public } from "../auth/capability";
import { bindNativePending } from "./native-auth.router";

/** A pending authorize request, stashed under `state` until /auth/callback. */
export interface AuthReq {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  prompt?: string;
  /**
   * 发起这次登录的界面形态。`native` = 桌面端（见 `native-auth.router.ts`）。
   * 缺省即浏览器——**不给默认值写成 `"web"`**：缺省与显式声明是两件事，
   * 将来要按形态分流时，「没声明」该走最保守的那一支。
   */
  surface?: "native";
  /** 桌面端给的 sha256 十六进制，回调时据它绑定待领会话。 */
  handle?: string;
}

/**
 * Redis key of a pending authorize request. Shared with TenantSwitchRouter: its
 * silent re-authorize (prompt=none + tenant_hint) lands on the same /auth/callback,
 * which must find the PKCE verifier under the same key.
 */
export function consoleAuthReqKey(prefix: string, state: string): string {
  return `${prefix}rp:console:authreq:${state}`;
}

@Public()
@Controller("auth")
export class OidcAuthRouter {
  constructor(
    @Inject(RP_OIDC_CLIENT) private readonly client: OidcRpClient,
    @Inject(RP_SESSION_STORE) private readonly store: RpSessionStore,
    @Inject(RP_AUTH_SERVICE) private readonly auth: RpAuthService,
    @Inject(RP_REDIS) private readonly redis: Redis,
    @Inject(RP_RUNTIME) private readonly rt: RpRuntime,
  ) {}

  /**
   * 桌面端登录完成后停的那个页面。
   *
   * 落回 console 自己的域名：用户是在 console 的登录流程里，跳到别处会让人以为出错。
   * `ok=0` 时页面提示「应用没接住，请回到应用重试」，而不是假装成功。
   */
  private nativeDonePage(ok: boolean): string {
    /* **不要放回 `/auth/` 下。** nginx 把 `/auth/` 整段代理给 console-bff，
       而 console 的 i18n middleware 又在 matcher 里排除了 `auth`——两边合起来的结果是
       这个路径到不了页面层，登录成功的用户看到一个 404。页面落在 `/native-done`，
       走 `/` 那条 location 到 Next，语言前缀由 middleware 补。 */
    const u = new URL("/native-done", this.rt.defaultReturnTo);
    if (!ok) u.searchParams.set("ok", "0");
    return u.toString();
  }

  private authReqKey(state: string): string {
    return consoleAuthReqKey(this.rt.keyPrefix, state);
  }

  /** __Host- in prod https; bare name over local http so the browser stores it. */
  private get cookieName(): string {
    return rpSessionCookieName(this.rt.cookieSecure, this.rt.config.clientId);
  }

  /**
   * SSO Presence —— 三态里唯一需要显式存储的那一态（Authenticated 由 RP 会话
   * cookie 自己表达，Unknown 是"两个都没有"）。契约在 `@vxture/core-identity-sdk`，
   * 与门户 middleware 共用一份；这里只把它给的 cookie 描述接到 express 上。
   */
  private get app(): string {
    return this.rt.config.clientId;
  }

  private markAnonymous(res: Response): void {
    const c = anonymousPresenceCookie(this.app, this.rt.cookieSecure);
    res.cookie(c.name, c.value, c.options);
  }

  /** 回到 Unknown。会话建立/注销时清掉，避免它继续压制静默探测。 */
  private clearPresence(res: Response): void {
    const c = clearPresenceCookie(this.app, this.rt.cookieSecure);
    res.clearCookie(c.name, c.options);
  }

  /** Begin login: stash PKCE/nonce/returnTo, redirect to the IdP authorize page. */
  @Get("login")
  async login(
    @Query("returnTo") returnTo: string | undefined,
    @Query("prompt") prompt: string | undefined,
    @Query("surface") surface: string | undefined,
    @Query("handle") handle: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    /* 上一轮刚确认过没有中央会话 → 这一轮别再静默问一遍，省掉
     * 「authorize(prompt=none) → callback(login_required) → 回门户」那 3 跳。
     * 门户 middleware 也做同一判断，这里是兜底：请求未必经过它（可直连 BFF），
     * 且这里拿到的 presence 是最新值。 */
    prompt = resolveLoginPrompt(
      prompt,
      req.cookies?.[presenceCookieName(this.app)] as string | undefined,
    );
    const { verifier, challenge } = generatePkce();
    const state = randomToken();
    const nonce = randomToken();
    const dest = safeReturnTo(
      returnTo,
      this.rt.allowedReturnOrigins,
      this.rt.defaultReturnTo,
    );
    /* 桌面端的两个参数**一起生效或一起不生效**：只给 surface 不给 handle，
       回调时无从绑定，用户会登录成功而应用永远领不到——那种失败没有任何提示。
       所以在入口就要求成对出现。 */
    const isNative = surface === "native" && typeof handle === "string";
    const payload: AuthReq = {
      codeVerifier: verifier,
      nonce,
      returnTo: dest,
      ...(prompt && { prompt }),
      ...(isNative ? { surface: "native" as const, handle } : {}),
    };
    await this.redis.setex(
      this.authReqKey(state),
      600,
      JSON.stringify(payload),
    );
    res.redirect(
      this.client.buildAuthorizeUrl({
        state,
        nonce,
        codeChallenge: challenge,
        ...(prompt !== undefined && { prompt }),
      }),
    );
  }

  /** OIDC callback: exchange the code, verify, establish the RP session, set cookie. */
  @Get("callback")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      // For prompt=none silent flows: login_required/interaction_required means
      // no active central session — redirect back to returnTo so the page renders
      // as unauthenticated without a visible error.
      if (
        (error === "login_required" || error === "interaction_required") &&
        state
      ) {
        const raw = await this.redis.getdel(this.authReqKey(state));
        if (raw) {
          const authReq = JSON.parse(raw) as AuthReq;
          if (authReq.prompt === "none") {
            // 记住这次静默失败，下一次 /auth/login?prompt=none 直接转交互式。
            this.markAnonymous(res);
            res.redirect(silentFailureReturnTo(authReq.returnTo));
            return;
          }
        }
      }
      res.status(401).json({ code: "OIDC_ERROR", message: error });
      return;
    }
    if (!code || !state) {
      res.status(400).json({ code: "INVALID_REQUEST" });
      return;
    }
    const raw = await this.redis.getdel(this.authReqKey(state));
    if (!raw) {
      res.status(400).json({ code: "INVALID_STATE" });
      return;
    }
    const authReq = JSON.parse(raw) as AuthReq;

    const tokens = await this.client.exchangeCode({
      code,
      codeVerifier: authReq.codeVerifier,
    });
    const id = await this.client.verifyIdToken(tokens.idToken, authReq.nonce);
    const accessClaims = await this.client.verifyAccessToken(
      tokens.accessToken,
    );

    const session: RpSession = {
      sid: id.sid,
      sub: id.sub,
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt,
      activeOrg: mapAccessClaims(accessClaims).activeOrg,
    };
    const rpsid = randomToken();
    await this.store.create(rpsid, session, this.rt.config.sessionTtlSec);
    /* 切租户走的是「静默重授权 → 新会话」:浏览器手里的旧 rpsid 随即被下面的
     * Set-Cookie 覆盖,服务端那份不收就一直躺到 TTL。顺手销毁(best-effort:
     * 收不掉也不该让登录失败)。 */
    const previous = req.cookies?.[this.cookieName] as string | undefined;
    if (previous && previous !== rpsid) {
      await this.store.destroy(previous).catch(() => undefined);
    }

    /* ── 桌面端：绑定待领，不种 cookie ──────────────────────────────────
       浏览器这一侧完成的是「批准」，不是「持有」。给它种 cookie 意味着系统浏览器里
       凭空多出一个没人会用的登录态——用户在浏览器里并没有要求登录 console。
       会话归应用，应用用自己那个从未外露的 deviceSecret 去领。 */
    if (authReq.surface === "native" && authReq.handle) {
      const bound = await bindNativePending(
        this.redis,
        this.rt.keyPrefix,
        authReq.handle,
        rpsid,
      );
      this.clearPresence(res);
      /* 停在一个纯提示页。**URL 里不带任何凭据**——回跳地址会进浏览器历史。
         绑定失败（handle 形状不合法）也要让用户看见，否则他会一直等着应用变化。 */
      res.redirect(this.nativeDonePage(bound));
      return;
    }

    res.cookie(this.cookieName, rpsid, {
      httpOnly: true,
      secure: this.rt.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: this.rt.config.sessionTtlSec * 1000,
    });
    /* 会话真建立了 → 清掉"没有中央会话"的备忘，否则它会在剩余有效期里继续压制
     * 静默 SSO（表现为登出后再登录要多走一次交互）。 */
    this.clearPresence(res);
    res.redirect(authReq.returnTo);
  }

  /** Current login state (verified claims) for the SPA bootstrap. */
  @Get("session")
  async session(@Req() req: Request): Promise<Record<string, unknown>> {
    const rpsid = req.cookies?.[this.cookieName] as string | undefined;
    const out = await this.auth.resolve(rpsid);
    if (out.status !== "ok") {
      throw new UnauthorizedException("No active session");
    }
    return { status: "active", claims: out.claims };
  }

  /**
   * Unified accounts post-logout URL, carrying the originating client, the intent
   * (signout|switch), and this RP's own /auth/login entry. The accounts post-logout
   * page reads these to route the user onward (origin-based home vs. re-login).
   * Only origin+path is open-redirect-checked by the IdP, so the extra query is fine.
   */
  private buildPostLogout(mode: "signout" | "switch"): string {
    const u = new URL(this.rt.postLogoutRedirectUri);
    u.searchParams.set("client", this.rt.config.clientId);
    u.searchParams.set("mode", mode);
    u.searchParams.set(
      "relogin",
      this.rt.config.redirectUri.replace(/\/auth\/callback$/, "/auth/login"),
    );
    return u.toString();
  }

  /**
   * Drop the local RP session + cookie, then top-level-redirect to the IdP
   * end_session — which kills the central session (vx_sid), back-channel-logs-out
   * all RPs, and lands on the unified accounts post-logout page.
   * identity-platform-access-topology.md §5.
   */
  private async endCentralSession(
    req: Request,
    res: Response,
    mode: "signout" | "switch",
  ): Promise<void> {
    const rpsid = req.cookies?.[this.cookieName] as string | undefined;
    if (rpsid) await this.store.destroy(rpsid);
    res.clearCookie(this.cookieName, { path: "/" });
    /* 回到 Unknown 而不是标 Anonymous：这条链路会去 IdP 结束中央会话，但"结束"
     * 是否成功要等它那边的响应，而 switch 模式本来就打算立刻重新登录。留一次
     * 静默探测去问真相，比在这里替 IdP 断言便宜也更准。 */
    this.clearPresence(res);
    res.redirect(
      this.client.buildEndSessionUrl({
        postLogoutRedirectUri: this.buildPostLogout(mode),
        state: randomToken(),
      }),
    );
  }

  /** RP-initiated sign-out (top-level GET so the browser sends vx_sid). */
  @Get("logout")
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.endCentralSession(req, res, "signout");
  }

  /**
   * "Switch user": end the session like logout, but signal the accounts page to
   * land on the login form (this RP's /auth/login → a fresh authorize) so the user
   * can immediately sign in as a different account.
   */
  @Get("switch")
  async switch(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.endCentralSession(req, res, "switch");
  }

  /**
   * Back-channel logout receiver (OpenID Back-Channel Logout 1.0): the IdP POSTs
   * a signed logout_token (form-encoded) when the central session ends; verify it
   * and destroy all RP sessions under that sid. Idempotent; 200 + no-store.
   * See identity-platform-access-topology.md §5.
   */
  @Post("backchannel-logout")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async backchannelLogout(
    @Body() body: { logout_token?: string },
  ): Promise<{ status: string }> {
    const token = body?.logout_token;
    if (!token) throw new BadRequestException("missing logout_token");
    let sid: string;
    try {
      ({ sid } = await this.client.verifyLogoutToken(token));
    } catch {
      throw new BadRequestException("invalid logout_token");
    }
    if (sid) await this.store.destroyBySid(sid);
    return { status: "logged_out" };
  }
}
