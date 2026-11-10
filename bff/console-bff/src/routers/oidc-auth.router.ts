/**
 * oidc-auth.router.ts - console RP auth endpoints (P1-e, additive)
 * @package @vxture/bff-console
 * @description
 *   /auth/* RP endpoints (outside api/*, so the legacy AuthMiddleware is not
 *   involved): login → IdP authorize, callback → token exchange + RP session,
 *   session lookup, native local logout, and browser global logout. Tokens stay
 *   server-side; the browser holds only the opaque __Host-vx_rp_session cookie.
 *   See identity-platform-rp-integration.md §2/§4.
 */
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  LOCALE_CONSTANTS,
  type Locale,
} from "@vxture-platform/shared";
import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
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
  /** Native approval and browser portal entry retain distinct session behavior. */
  surface?: "native" | "portal";
  binding?: string;
  userId?: string;
  /** Native SHA-256 device handle. */
  handle?: string;
  /** Requested scope; verified against issued claims before creating a session. */
  tenantId?: string;
  workspaceId?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  // ========================================================================
  // Browser portal entry: exact account/scope and one-time browser binding
  // ========================================================================
  private bindingCookie(state: string): string {
    return `${this.rt.cookieSecure ? "__Host-" : ""}vx_console_auth_${state}`;
  }

  private async assertPortalAccount(
    req: Request,
    userId: string,
  ): Promise<void> {
    const currentId: unknown = req.cookies?.[this.cookieName];
    const current =
      typeof currentId === "string" ? await this.store.get(currentId) : null;
    if (current && current.sub !== `usr_${userId}`)
      throw new ConflictException({
        code: "PORTAL_ACCOUNT_MISMATCH",
        message:
          "The target portal uses another account; switch accounts explicitly",
      });
  }

  private async consumeRequest(
    state: string,
    req: Request,
    res: Response,
  ): Promise<AuthReq | null> {
    const raw = await this.redis.get(this.authReqKey(state));
    if (!raw) return null;
    const pending = JSON.parse(raw) as AuthReq;
    if (pending.surface === "portal") {
      const cookie: unknown = req.cookies?.[this.bindingCookie(state)];
      if (typeof cookie !== "string" || !pending.binding) return null;
      const actual = createHash("sha256").update(cookie).digest("hex");
      if (
        actual.length !== pending.binding.length ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(pending.binding))
      )
        return null;
    }
    if ((await this.redis.getdel(this.authReqKey(state))) !== raw) return null;
    if (pending.surface === "portal")
      res.clearCookie(this.bindingCookie(state), {
        path: "/",
        secure: this.rt.cookieSecure,
        httpOnly: true,
        sameSite: "lax",
      });
    return pending;
  }

  /** Begin login: stash PKCE/nonce/returnTo, redirect to the IdP authorize page. */
  @Get("login")
  @Header("Cache-Control", "no-store")
  async login(
    @Query("returnTo") returnTo: string | undefined,
    @Query("prompt") prompt: string | undefined,
    @Query("surface") surface: string | undefined,
    @Query("handle") handle: string | undefined,
    @Query("tenantId") tenantId: unknown,
    @Query("workspaceId") workspaceId: unknown,
    @Query("userId") userId: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const isNative = surface === "native";
    const isPortal = surface === "portal";
    const hasTarget = tenantId !== undefined || workspaceId !== undefined;
    const query = new URL(req.originalUrl, this.rt.defaultReturnTo)
      .searchParams;
    if (
      [
        "surface",
        "handle",
        "tenantId",
        "workspaceId",
        "userId",
        "prompt",
        "returnTo",
      ].some((key) => query.getAll(key).length > 1) ||
      [...query.keys()].some((key) =>
        /^(surface|handle|tenantId|workspaceId|userId|prompt|returnTo)\[/.test(
          key,
        ),
      ) ||
      (isNative &&
        (typeof handle !== "string" || !/^[0-9a-f]{64}$/.test(handle))) ||
      (!isNative &&
        !isPortal &&
        (handle !== undefined || hasTarget || userId !== undefined)) ||
      (isNative && userId !== undefined) ||
      (isPortal &&
        (handle !== undefined ||
          prompt !== undefined ||
          typeof userId !== "string" ||
          !UUID_RE.test(userId) ||
          tenantId === undefined ||
          workspaceId === undefined)) ||
      (tenantId !== undefined &&
        (typeof tenantId !== "string" || !UUID_RE.test(tenantId))) ||
      (workspaceId !== undefined &&
        (typeof workspaceId !== "string" || !UUID_RE.test(workspaceId)))
    ) {
      throw new BadRequestException({
        code: isPortal
          ? "PORTAL_LOGIN_REQUEST_INVALID"
          : "NATIVE_LOGIN_REQUEST_INVALID",
        message: isPortal
          ? "Portal entry requires one account and exact UUID workspace context"
          : "Native login requires a SHA-256 handle and unambiguous UUID scope hints",
      });
    }
    if (isPortal)
      await this.assertPortalAccount(req, String(userId).toLowerCase());
    const targetTenant =
      typeof tenantId === "string" ? tenantId.toLowerCase() : undefined;
    const targetWorkspace =
      typeof workspaceId === "string" ? workspaceId.toLowerCase() : undefined;
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
    const binding = isPortal ? randomToken() : undefined;
    const dest = safeReturnTo(
      returnTo,
      this.rt.allowedReturnOrigins,
      this.rt.defaultReturnTo,
    );
    // Explicit entry surfaces must never degrade into an unscoped browser login.
    const payload: AuthReq = {
      codeVerifier: verifier,
      nonce,
      returnTo: dest,
      ...(prompt && { prompt }),
      ...(isPortal && binding
        ? {
            surface: "portal" as const,
            userId: String(userId).toLowerCase(),
            binding: createHash("sha256").update(binding).digest("hex"),
          }
        : {}),
      ...(isNative && typeof handle === "string"
        ? { surface: "native" as const, handle }
        : {}),
      ...(targetTenant ? { tenantId: targetTenant } : {}),
      ...(targetWorkspace ? { workspaceId: targetWorkspace } : {}),
    };
    await this.redis.setex(
      this.authReqKey(state),
      600,
      JSON.stringify(payload),
    );
    if (binding)
      res.cookie(this.bindingCookie(state), binding, {
        httpOnly: true,
        secure: this.rt.cookieSecure,
        sameSite: "lax",
        path: "/",
        maxAge: 600000,
      });
    res.redirect(
      this.client.buildAuthorizeUrl({
        state,
        nonce,
        codeChallenge: challenge,
        uiLocales: (() => {
          const queryLocale: unknown = req.query.ui_locales;
          const cookieLocale: unknown =
            req.cookies?.[LOCALE_CONSTANTS.COOKIE_KEY];
          const preferred = queryLocale ?? cookieLocale;
          return SUPPORTED_LOCALES.includes(preferred as Locale)
            ? (preferred as Locale)
            : DEFAULT_LOCALE;
        })(),
        ...(prompt !== undefined && { prompt }),
        ...(targetTenant ? { tenantHint: targetTenant } : {}),
        ...(targetWorkspace ? { workspaceHint: targetWorkspace } : {}),
      }),
    );
  }

  /** OIDC callback: exchange the code, verify, establish the RP session, set cookie. */
  @Get("callback")
  @Header("Cache-Control", "no-store")
  async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const query = new URL(req.originalUrl, this.rt.defaultReturnTo)
      .searchParams;
    if (
      ["state", "code", "error"].some((key) => query.getAll(key).length > 1) ||
      (state !== undefined && typeof state !== "string") ||
      (code !== undefined && typeof code !== "string") ||
      (error !== undefined && typeof error !== "string")
    ) {
      res.status(400).json({ code: "INVALID_REQUEST" });
      return;
    }
    if (error) {
      // For prompt=none silent flows: login_required/interaction_required means
      // no active central session — redirect back to returnTo so the page renders
      // as unauthenticated without a visible error.
      if (
        (error === "login_required" || error === "interaction_required") &&
        state
      ) {
        const authReq = await this.consumeRequest(state, req, res);
        if (authReq) {
          if (authReq.prompt === "none" && authReq.surface !== "native") {
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
    const authReq = await this.consumeRequest(state, req, res);
    if (!authReq) {
      res.status(400).json({ code: "INVALID_STATE" });
      return;
    }

    const tokens = await this.client.exchangeCode({
      code,
      codeVerifier: authReq.codeVerifier,
    });
    const id = await this.client.verifyIdToken(tokens.idToken, authReq.nonce);
    const accessClaims = await this.client.verifyAccessToken(
      tokens.accessToken,
    );

    const scope = mapAccessClaims(accessClaims);
    // IdP hints may fall back to defaults. Never hand the desktop a session for
    // a different scope while reporting its requested switch as successful.
    if (
      authReq.surface === "native" &&
      ((authReq.tenantId && scope.activeOrg !== authReq.tenantId) ||
        (authReq.workspaceId &&
          (scope.activeWorkspace !== authReq.workspaceId ||
            !scope.roles.some((role) => role.startsWith("workspace:")))))
    ) {
      res.status(403).json({
        code: "NATIVE_CONTEXT_NOT_APPLIED",
        message:
          "The requested tenant or workspace is not accessible; no session was bound",
      });
      return;
    }

    if (authReq.surface === "portal") {
      if (
        id.sub !== `usr_${authReq.userId}` ||
        scope.sub !== id.sub ||
        scope.userType !== "tenant_user" ||
        scope.accountStatus !== "active" ||
        (accessClaims.sid !== undefined && accessClaims.sid !== id.sid)
      ) {
        res.status(403).json({
          code: "PORTAL_ACCOUNT_MISMATCH",
          message:
            "Central SSO did not return the requested active customer account",
        });
        return;
      }
      if (
        scope.activeOrg !== authReq.tenantId ||
        scope.activeWorkspace !== authReq.workspaceId ||
        !scope.roles.some((role) => role.startsWith("workspace:"))
      ) {
        res.status(403).json({
          code: "PORTAL_CONTEXT_NOT_APPLIED",
          message: "The requested organization or workspace is not accessible",
        });
        return;
      }
      await this.assertPortalAccount(req, authReq.userId!);
    }

    const session: RpSession = {
      sid: id.sid,
      sub: id.sub,
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt,
      activeOrg: scope.activeOrg,
    };
    const rpsid = randomToken();
    await this.store.create(rpsid, session, this.rt.config.sessionTtlSec);

    /* ── 桌面端：绑定待领，不种 cookie ──────────────────────────────────
       浏览器这一侧完成的是「批准」，不是「持有」。给它种 cookie 意味着系统浏览器里
       凭空多出一个没人会用的登录态——用户在浏览器里并没有要求登录 console。
       会话归应用，应用用自己那个从未外露的 deviceSecret 去领。 */
    if (authReq.surface === "native" && authReq.handle) {
      let bound: boolean;
      try {
        bound = await bindNativePending(
          this.redis,
          this.rt.keyPrefix,
          authReq.handle,
          rpsid,
        );
      } catch (error) {
        await this.store.destroy(rpsid);
        throw error;
      }
      if (!bound) await this.store.destroy(rpsid);
      /* 停在一个纯提示页。**URL 里不带任何凭据**——回跳地址会进浏览器历史。
         绑定失败（handle 形状不合法）也要让用户看见，否则他会一直等着应用变化。 */
      res.redirect(this.nativeDonePage(bound));
      return;
    }

    // Only browser flows replace their cookie session. Native approval must
    // preserve the system browser's existing RP session and presence state.
    const previous = req.cookies?.[this.cookieName] as string | undefined;
    if (previous && previous !== rpsid) {
      await this.store.destroy(previous).catch(() => undefined);
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
   * Destroy only the explicitly supplied RP session, without ending IdP SSO.
   * The legacy POST path serves desktop clients already using /auth/logout.
   * Cookies are deliberately ignored: ambient browser credentials must not
   * select a session for this native-only operation.
   *
   * @throws {BadRequestException} The session header is missing or ambiguous.
   * @throws {ServiceUnavailableException} Session storage cannot complete logout.
   */
  @Post(["native/logout", "logout"])
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "no-store")
  async nativeLogout(@Req() req: Request): Promise<void> {
    const rpsid = req.headers["x-vxture-session"];
    const headerCount = req.rawHeaders.filter(
      (value, index) =>
        index % 2 === 0 && value.toLowerCase() === "x-vxture-session",
    ).length;
    // Node joins duplicate custom headers; reject them even when values match.
    // Keep the handle opaque rather than tying the API to a generated length.
    if (
      headerCount !== 1 ||
      typeof rpsid !== "string" ||
      rpsid.length === 0 ||
      /[\s,]/.test(rpsid)
    ) {
      throw new BadRequestException({
        code: "NATIVE_SESSION_HEADER_INVALID",
        message: "A single non-empty X-Vxture-Session header is required",
        retryable: false,
      });
    }

    try {
      // Do not resolve or refresh tokens just to destroy an expired RP session.
      await this.store.destroy(rpsid);
    } catch {
      throw new ServiceUnavailableException({
        code: "NATIVE_LOGOUT_UNAVAILABLE",
        message: "Session logout could not be completed; retry the request",
        retryable: true,
      });
    }
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
