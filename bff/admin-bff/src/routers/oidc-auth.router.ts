/**
 * oidc-auth.router.ts - admin (operator) RP auth endpoints (P2, additive)
 * @package @vxture/bff-admin
 * @description
 *   /auth/* RP endpoints (outside api/*, so the legacy AuthMiddleware is not
 *   involved): login → IdP authorize (operator realm), callback → token
 *   exchange + RP session, session lookup, local logout. Tokens stay
 *   server-side; the browser holds only the opaque __Host-vx_rp_session cookie.
 *   Operator sessions are isolated from the tenant realm by construction
 *   (aud=admin, sub=opr_, userType=operator). See docs/design/identity-platform-operator.md §3/§4.
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

interface AuthReq {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  prompt?: string;
}

@Controller("auth")
export class OidcAuthRouter {
  constructor(
    @Inject(RP_OIDC_CLIENT) private readonly client: OidcRpClient,
    @Inject(RP_SESSION_STORE) private readonly store: RpSessionStore,
    @Inject(RP_AUTH_SERVICE) private readonly auth: RpAuthService,
    @Inject(RP_REDIS) private readonly redis: Redis,
    @Inject(RP_RUNTIME) private readonly rt: RpRuntime,
  ) {}

  private authReqKey(state: string): string {
    return `${this.rt.keyPrefix}rp:admin:authreq:${state}`;
  }

  /** __Host- in prod https; bare name over local http so the browser stores it. */
  private get cookieName(): string {
    return rpSessionCookieName(this.rt.cookieSecure, this.rt.config.clientId);
  }

  /**
   * 登出后的落点：身份面统一的 `/logout` 屏，带上"谁发起的"和"从哪回来"。
   *
   * **不落回本门户首页。** 全局登出结束的是中央会话，不是本门户那一份；回首页只会
   * 被网关立刻弹去登录，制造"登出了又要我登录"的困惑。落到身份面才对得上刚发生
   * 的事，那一屏也能给出再次登录的入口。
   *
   * 白名单按 origin+path 匹配，query 不参与——所以这两个参数不影响校验。
   */
  private postLogoutTarget(): string {
    const u = new URL("/logout", this.rt.config.issuer);
    u.searchParams.set("client", this.rt.config.clientId);
    u.searchParams.set(
      "relogin",
      `${this.rt.defaultReturnTo.replace(/\/$/, "")}/auth/login`,
    );
    return u.toString();
  }

  /**
   * SSO Presence —— 身份状态缓存，三态里唯一需要显式存储的那一态（Authenticated
   * 由 RP 会话 cookie 自己表达，Unknown 是"两个都没有"）。
   *
   * 名字、值、时效与读写规则都在 `@vxture/core-identity-sdk`——**这一份契约必须被
   * BFF 与门户 middleware 同时认同**，各写各的迟早分叉，而分叉的症状是无限重定向
   * 或登不进去，都不好归因。这里只负责把 SDK 给的 cookie 描述接到 express 上。
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
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    /* 上一轮刚确认过没有中央会话 → 这一轮别再静默问一遍。省掉的正是
     * 「authorize(prompt=none) → callback(login_required) → 回门户」那 3 跳
     * 和随之而来的一次整页绘制；用户直接落到 IdP 登录页。
     *
     * 门户 middleware 也做同一判断，这里不是重复而是兜底：请求未必经过 middleware
     * （直接访问 BFF 域名），且这里拿到的 presence 是最新值。 */
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
    const payload: AuthReq = {
      codeVerifier: verifier,
      nonce,
      returnTo: dest,
      ...(prompt && { prompt }),
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
    await this.client.verifyAccessToken(tokens.accessToken);

    // Operator sessions carry no organization — activeOrg is always null.
    const session: RpSession = {
      sid: id.sid,
      sub: id.sub,
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt,
      activeOrg: null,
    };
    const rpsid = randomToken();
    await this.store.create(rpsid, session, this.rt.config.sessionTtlSec);

    res.cookie(this.cookieName, rpsid, {
      httpOnly: true,
      secure: this.rt.cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: this.rt.config.sessionTtlSec * 1000,
    });
    // 会话真建立了 → 清掉"没有中央会话"的备忘，否则它会在剩余有效期里继续
    // 压制静默 SSO（表现为登出后再登录要多走一次交互）。
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
   * 登出：清掉本地 RP 会话，并交回 IdP 的 end_session 地址。
   *
   * 这里**不**替浏览器去调 end_session。中央会话的凭证是 accounts 域上的
   * `vx_sid_op`（SameSite=Lax）：BFF 发起的服务端调用没有它，浏览器发起的跨站
   * fetch 也不带它，两条路都只会让 IdP 看到一个匿名请求、什么都不结束。唯一能带上
   * 它的是**顶层导航**，所以地址由前端拿去 `location.replace`。
   *
   * `id_token_hint` 取自即将销毁的会话，得在 destroy 之前读。
   */
  @Post("logout")
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const rpsid = req.cookies?.[this.cookieName] as string | undefined;
    const session = rpsid ? await this.store.get(rpsid) : null;
    if (rpsid) await this.store.destroy(rpsid);
    res.clearCookie(this.cookieName, { path: "/" });
    /* 登出后不要留着"有/没有中央会话"的备忘：它下一轮会压制静默探测。 */
    this.clearPresence(res);
    res.json({
      status: "logged_out",
      endSessionUrl: this.client.buildEndSessionUrl({
        ...(session ? { idTokenHint: session.idToken } : {}),
        postLogoutRedirectUri: this.postLogoutTarget(),
      }),
    });
  }
  /**
   * 后端通道登出接收端（OpenID Back-Channel Logout 1.0）。中央会话结束时 IdP 会
   * 往这里 POST 一枚签名的 logout_token；验签后销毁该 sid 下的所有 RP 会话。
   *
   * **没有它，全局登出就只是半条链路**：中央会话结束了，本门户的 RP 会话却还活着，
   * 而 RP 会话有自己的 TTL、从不回头问 IdP——用户看到的就是"另一个门户没跟着登出"。
   *
   * 幂等；no-store。见 identity-platform-access-topology.md §5。
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
