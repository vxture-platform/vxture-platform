/**
 * oidc-auth.router.ts - Capability Console (workforce) RP auth endpoints
 * @package @vxture/bff-opera
 * @description
 *   /auth/* RP endpoints: login → IdP authorize (workforce realm), callback →
 *   token exchange + RP session, session lookup, local logout. Tokens stay
 *   server-side; the browser holds only the opaque __Host-vx_rp_session cookie.
 *
 *   /auth/check is the nginx auth_request gate (product_250 M-4 hardening:
 *   "any path, no content unauthenticated"). It resolves the RP session and,
 *   when the original URI targets a mounted provider module (/atlas/*, /runos/*),
 *   mints an operator-OBO management token (M-1) and returns it in
 *   X-Operator-Token so nginx injects it as the Authorization header on the
 *   proxied module request. See docs/20-specs/000-platform/opera/
 *   10-shell-mount-contract.md.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
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
import { OperatorExchangeService } from "../auth/operator-exchange.service";
import { unauthenticated } from "../errors/api-error";
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

/**
 * Mount-path prefix → provider audience (product_code). The mount points are
 * contract-fixed (10-shell-mount-contract.md §2); a new L1 module = one more
 * entry here + its nginx location block.
 */
const MODULE_AUD_BY_PREFIX: Record<string, string> = {
  "/atlas": "atlas",
  "/runos": "runos",
};

export function moduleAudFor(originalUri: string | undefined): string | null {
  if (!originalUri) return null;
  const path = originalUri.split("?")[0] ?? "";
  for (const [prefix, aud] of Object.entries(MODULE_AUD_BY_PREFIX)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return aud;
  }
  return null;
}

@Controller("auth")
export class OidcAuthRouter {
  constructor(
    @Inject(RP_OIDC_CLIENT) private readonly client: OidcRpClient,
    @Inject(RP_SESSION_STORE) private readonly store: RpSessionStore,
    @Inject(RP_AUTH_SERVICE) private readonly auth: RpAuthService,
    @Inject(RP_REDIS) private readonly redis: Redis,
    @Inject(RP_RUNTIME) private readonly rt: RpRuntime,
    @Inject(OperatorExchangeService)
    private readonly exchange: OperatorExchangeService,
  ) {}

  private authReqKey(state: string): string {
    return `${this.rt.keyPrefix}rp:opera:authreq:${state}`;
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
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    /* 上一轮刚确认过没有中央会话 → 这一轮别再静默问一遍，省掉
     * 「authorize(prompt=none) → callback(login_required) → 回门户」那 3 跳。
     * 门户 middleware 也做同一判断，这里是兜底：请求未必经过它（生产上 nginx
     * auth_request 网关会先拦，且 /auth/login 可被直连）。 */
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
      // prompt=none silent flows: no active central session — return to the
      // page as unauthenticated without a visible error.
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
      /* 这三处是手写响应、不经异常过滤器，所以封套要在这里补齐（X-1）：原来
         `INVALID_REQUEST` / `INVALID_STATE` 连 message 都没有，浏览器上就是一
         片空白，而这恰恰是登录失败最需要说清楚的地方。 */
      res.status(401).json({
        code: "OIDC_ERROR",
        message: error,
        retryable: false,
        statusCode: 401,
      });
      return;
    }
    if (!code || !state) {
      res.status(400).json({
        code: "OIDC_INVALID_REQUEST",
        message: "Missing code or state on the OIDC callback",
        retryable: false,
        statusCode: 400,
      });
      return;
    }
    const raw = await this.redis.getdel(this.authReqKey(state));
    if (!raw) {
      /* state 在 Redis 里找不到——过期或已被用掉。重新发起登录就好，所以这是
         少数几个真的可重试的 4xx。 */
      res.status(400).json({
        code: "OIDC_INVALID_STATE",
        message: "Authorization request expired or already consumed",
        retryable: true,
        statusCode: 400,
      });
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
    /* 会话真建立了 → 清掉"没有中央会话"的备忘，否则它会在剩余有效期里继续压制
     * 静默 SSO（表现为登出后再登录要多走一次交互）。 */
    this.clearPresence(res);
    res.redirect(authReq.returnTo);
  }

  /** Current login state (verified claims) for the shell bootstrap. */
  @Get("session")
  async session(@Req() req: Request): Promise<Record<string, unknown>> {
    const rpsid = req.cookies?.[this.cookieName] as string | undefined;
    const out = await this.auth.resolve(rpsid);
    if (out.status !== "ok") {
      throw unauthenticated("AUTH_NO_SESSION", "No active session");
    }
    return { status: "active", claims: out.claims };
  }

  /**
   * nginx auth_request gate. 204 = authenticated (nginx serves the gated
   * location); 401 = no/expired session (nginx redirects the navigation to
   * /auth/login). For module paths the response carries X-Operator-Token —
   * the operator-OBO management token nginx injects upstream (M-1). The
   * exchange is cached per (subject, aud), so per-request cost is a Redis
   * session read on the hot path.
   */
  @Get("check")
  async check(
    @Req() req: Request,
    @Headers("x-original-uri") originalUri: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const rpsid = req.cookies?.[this.cookieName] as string | undefined;
    const out = await this.auth.resolve(rpsid);
    if (out.status !== "ok") {
      res.status(401).end();
      return;
    }

    const aud = moduleAudFor(originalUri);
    if (aud) {
      const token = await this.exchange.getToken(out.accessToken, aud);
      if (token) {
        res.setHeader("X-Operator-Token", token);
      }
    }
    res.status(204).end();
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
