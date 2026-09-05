/**
 * tenant-switch.router.ts - 切换活跃租户(identity/080-rp-integration §2.8)。
 * @package @vxture/bff-console
 * @description
 *   顶栏「切换范围」/ 账号页「租户信息」跳转 / 接受邀请后进入受邀租户,都走这一条:
 *
 *     浏览器 ─顶层 GET /auth/switch-tenant?tenantId&returnTo─▶ console-bff
 *       预检:目标须在本人可进入的租户内(tenants[] 不进 token,服务端回查成员关系)
 *       302 IdP /oidc/authorize?prompt=none&tenant_hint={tenantId}
 *     IdP 改 (sid, client_id) 的 active_org → 静默发码 → /auth/callback 建新 RP 会话
 *       → 回到 returnTo,页面整体重载到新租户
 *
 *   必须是顶层导航而不是 fetch:IdP 要收到中央会话 cookie(vx_sid)才能静默发码。
 *   作用域按应用——IdP 只改 console 这个 client 的 active_org,不波及 website / ruyin。
 *
 *   为什么单独一个控制器而不进 OidcAuthRouter:预检要回查成员关系(SessionAggregator,
 *   根模块的 provider),OidcRpModule 拿不到它;而 RP 五件套是从 OidcRpModule 导出的,
 *   根模块里的控制器两边都能注入。
 *
 *   此前前端 POST 到早已退役的 /api/auth/tenant/switch(404),切换从未生效——
 *   header 上怎么点都停在同一个租户(owner 2026-09-05 走查)。
 */
import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  generatePkce,
  mapAccessClaims,
  randomToken,
  rpSessionCookieName,
  safeReturnTo,
  type OidcRpClient,
  type RpAuthService,
} from "@vxture/core-oidc-rp";
import type { Redis } from "ioredis";
import { SessionAggregator } from "../aggregators/session.aggregator";
import { Public } from "../auth/capability";
import {
  RP_AUTH_SERVICE,
  RP_OIDC_CLIENT,
  RP_REDIS,
  RP_RUNTIME,
  type RpRuntime,
} from "../oidc/oidc-rp.tokens";
import { consoleAuthReqKey, type AuthReq } from "./oidc-auth.router";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 与 OidcAuthRouter.login 同一个 TTL:授权请求的暂存只需活过一次跳转。 */
const AUTH_REQ_TTL_SEC = 600;

@Public()
@Controller("auth")
export class TenantSwitchRouter {
  constructor(
    @Inject(RP_OIDC_CLIENT) private readonly client: OidcRpClient,
    @Inject(RP_AUTH_SERVICE) private readonly auth: RpAuthService,
    @Inject(RP_REDIS) private readonly redis: Redis,
    @Inject(RP_RUNTIME) private readonly rt: RpRuntime,
    @Inject(SessionAggregator)
    private readonly sessionAggregator: SessionAggregator,
  ) {}

  private get cookieName(): string {
    return rpSessionCookieName(this.rt.cookieSecure, this.rt.config.clientId);
  }

  private get loginUrl(): string {
    return this.rt.config.redirectUri.replace(
      /\/auth\/callback$/,
      "/auth/login",
    );
  }

  @Get("switch-tenant")
  async switchTenant(
    @Query("tenantId") tenantId: string | undefined,
    @Query("returnTo") returnTo: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const dest = safeReturnTo(
      returnTo,
      this.rt.allowedReturnOrigins,
      this.rt.defaultReturnTo,
    );

    const rpsid = req.cookies?.[this.cookieName] as string | undefined;
    const outcome = await this.auth.resolve(rpsid);
    if (outcome.status !== "ok") {
      // 没有可用会话就不谈切换:走正常登录,登完回到原页。
      res.redirect(`${this.loginUrl}?returnTo=${encodeURIComponent(dest)}`);
      return;
    }
    const user = mapAccessClaims(outcome.claims);
    const target = (tenantId ?? "").trim();

    // 预检(§2.8):形状先挡,再回查成员关系。不合格一律原样回到 returnTo——
    // 这是一次顶层导航,回 JSON 错误等于把用户扔到一页裸 JSON 上。
    if (
      !UUID_RE.test(target) ||
      !(await this.sessionAggregator.isMemberOf(user.userId, target))
    ) {
      res.redirect(dest);
      return;
    }
    if (user.activeOrg === target) {
      res.redirect(dest);
      return;
    }

    const { verifier, challenge } = generatePkce();
    const state = randomToken();
    const nonce = randomToken();
    const payload: AuthReq = {
      codeVerifier: verifier,
      nonce,
      returnTo: dest,
      prompt: "none",
    };
    await this.redis.setex(
      consoleAuthReqKey(this.rt.keyPrefix, state),
      AUTH_REQ_TTL_SEC,
      JSON.stringify(payload),
    );
    res.redirect(
      this.client.buildAuthorizeUrl({
        state,
        nonce,
        codeChallenge: challenge,
        prompt: "none",
        tenantHint: target,
      }),
    );
  }
}
