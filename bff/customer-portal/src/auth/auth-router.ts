/**
 * Browser-bound OIDC entry with exact organization authorization before session creation.
 * @package @vxture/bff-customer-portal
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-15
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import {
  generatePkce,
  mapAccessClaims,
  randomToken,
} from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: reuse verified identity mapping and browser-binding primitives.
import { PortalGateway } from "../gateway";
import type { PortalRuntime } from "../config";
import { validateBinding } from "./oidc-client";
import { failure } from "../errors";

interface PendingLogin {
  nonce: string;
  verifier: string;
  binding: string;
  tenantId: string;
  workspaceId: string;
}
const HANDLE = /^[A-Za-z0-9_-]{32,128}$/;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
});
const stateCookie = (state: string): string =>
  `__Host-vx_customer_portal_auth_${state}`;

/** Reject ambiguous OAuth parameters instead of letting parsers choose an identity context. */
function parameter(req: Request, name: string): string | undefined {
  const query = new URL(req.originalUrl, "https://localhost").searchParams;
  if (
    query.getAll(name).length > 1 ||
    [...query.keys()].some((key) => key.startsWith(`${name}[`))
  )
    throw failure(
      400,
      "CUSTOMER_PORTAL_REQUEST_INVALID",
      "Invalid authentication parameters",
    );
  const value: unknown = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 4096)
    throw failure(
      400,
      "CUSTOMER_PORTAL_REQUEST_INVALID",
      "Invalid authentication parameters",
    );
  return value;
}
function navigation(req: Request, runtime: PortalRuntime): void {
  const source = req.headers["sec-fetch-site"];
  if (
    (source && source !== "same-origin" && source !== "none") ||
    (req.headers.origin && req.headers.origin !== runtime.origin)
  )
    throw failure(
      403,
      "CUSTOMER_PORTAL_ORIGIN_REQUIRED",
      "请从当前门户发起此操作",
    );
}

@Controller("auth")
export class AuthRouter {
  constructor(@Inject(PortalGateway) private readonly gateway: PortalGateway) {}

  // ========================================================================
  // One-time, host- and browser-bound authorization code flow
  // ========================================================================
  @Get("login")
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { runtime, store, client } = await this.gateway.context(req);
    navigation(req, runtime);
    const state = randomToken(),
      binding = randomToken(),
      nonce = randomToken(),
      pkce = generatePkce();
    const pending: PendingLogin = {
      nonce,
      verifier: pkce.verifier,
      binding: digest(binding),
      tenantId: runtime.binding.tenantId,
      workspaceId: runtime.binding.workspaceId,
    };
    await store.redis.setex(
      `${store.prefix}authreq:${state}`,
      600,
      JSON.stringify(pending),
    );
    res.cookie(stateCookie(state), binding, {
      ...cookieOptions(),
      maxAge: 600000,
    });
    res.redirect(
      client.buildAuthorizeUrl({
        state,
        nonce,
        codeChallenge: pkce.challenge,
        tenantHint: pending.tenantId,
        workspaceHint: pending.workspaceId,
        uiLocales: "zh-CN",
        prompt: "select_account",
      }),
    );
  }

  @Get("callback")
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const context = await this.gateway.context(req);
    const { runtime, store, client, sessions } = context;
    const state = parameter(req, "state");
    if (!state || !HANDLE.test(state))
      throw failure(
        400,
        "CUSTOMER_PORTAL_STATE_INVALID",
        "登录请求已失效，请重新登录",
      );
    const cookie: unknown = (
      req.cookies as Record<string, unknown> | undefined
    )?.[stateCookie(state)];
    const key = `${store.prefix}authreq:${state}`;
    const raw = await store.redis.get(key);
    if (!raw || typeof cookie !== "string")
      throw failure(
        400,
        "CUSTOMER_PORTAL_STATE_INVALID",
        "登录请求不属于当前浏览器或门户",
      );
    const pending = JSON.parse(raw) as PendingLogin;
    const actual = digest(cookie);
    if (
      actual.length !== pending.binding.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(pending.binding)) ||
      (await store.redis.getdel(key)) !== raw
    )
      throw failure(
        400,
        "CUSTOMER_PORTAL_STATE_INVALID",
        "登录请求已使用或浏览器校验失败",
      );
    res.clearCookie(stateCookie(state), cookieOptions());
    if (
      pending.tenantId !== runtime.binding.tenantId ||
      pending.workspaceId !== runtime.binding.workspaceId
    )
      throw failure(
        403,
        "CUSTOMER_PORTAL_BINDING_CHANGED",
        "门户绑定已更新，请重新登录",
      );
    const authorizationError = parameter(req, "error");
    if (authorizationError === "access_denied")
      throw failure(
        403,
        "CUSTOMER_PORTAL_ACCESS_DENIED",
        "当前账号未获得本机构的访问权限",
      );
    if (authorizationError)
      throw failure(
        401,
        "CUSTOMER_PORTAL_LOGIN_FAILED",
        "认证未完成，请重新登录",
      );
    const code = parameter(req, "code");
    if (!code)
      throw failure(400, "CUSTOMER_PORTAL_REQUEST_INVALID", "缺少认证凭据");
    const tokens = await client.exchangeCode({
      code,
      codeVerifier: pending.verifier,
    });
    const identity = await client.verifyIdToken(tokens.idToken, pending.nonce);
    const access = await client.verifyAccessToken(tokens.accessToken);
    validateBinding(identity, access);
    // Hints are not permissions: reject IdP fallback and revoked live memberships.
    await this.gateway.assertMember(context, mapAccessClaims(access));
    const central = await client.centralStatus(identity.sid);
    if (!central.valid)
      throw failure(
        401,
        "CUSTOMER_PORTAL_LOGIN_REQUIRED",
        "统一身份会话已结束",
      );
    const id = randomToken();
    await store.create(id, {
      ...tokens,
      sid: identity.sid,
      sub: identity.sub,
      org: runtime.binding.tenantId,
      workspace: runtime.binding.workspaceId,
      expiresAt: Math.floor(Date.now() / 1000) + runtime.oidc.sessionTtlSec,
      nextCheckAt: central.nextCheckAt,
    });
    const old = sessions.cookie(req);
    if (old) await store.destroy(old);
    res.cookie(runtime.cookieName, id, {
      ...cookieOptions(),
      maxAge: runtime.oidc.sessionTtlSec * 1000,
    });
    res.redirect(`${runtime.origin}/workspace`);
  }

  @Get("session")
  async session(@Req() req: Request) {
    const context = await this.gateway.context(req);
    const current = await this.gateway.authenticate(req, context);
    return { status: "active", userId: current.user.userId };
  }

  // ========================================================================
  // Explicit local logout plus central session checks and signed back-channel logout
  // ========================================================================
  @Get("logout")
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const { runtime, store, sessions, client } =
      await this.gateway.context(req);
    navigation(req, runtime);
    const id = sessions.cookie(req);
    if (id) await store.destroy(id);
    res.clearCookie(runtime.cookieName, cookieOptions());
    res.redirect(
      client.buildEndSessionUrl({
        postLogoutRedirectUri: `${runtime.origin}/`,
      }),
    );
  }

  @Post("backchannel-logout")
  async backchannel(
    @Req() req: Request,
    @Body() body: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const { client, store } = await this.gateway.context(req);
    if (
      !body ||
      typeof body !== "object" ||
      !("logout_token" in body) ||
      typeof body.logout_token !== "string"
    )
      throw failure(
        400,
        "CUSTOMER_PORTAL_LOGOUT_INVALID",
        "Missing logout token",
      );
    try {
      const verified = await client.verifyLogoutToken(body.logout_token);
      const payload: unknown = JSON.parse(
        Buffer.from(body.logout_token.split(".")[1]!, "base64url").toString(
          "utf8",
        ),
      );
      const now = Math.floor(Date.now() / 1000);
      if (
        !payload ||
        typeof payload !== "object" ||
        !("exp" in payload) ||
        typeof payload.exp !== "number" ||
        !Number.isFinite(payload.exp) ||
        payload.exp <= now ||
        !("iat" in payload) ||
        typeof payload.iat !== "number" ||
        !Number.isFinite(payload.iat) ||
        payload.iat > now + 60 ||
        !("jti" in payload) ||
        typeof payload.jti !== "string" ||
        !payload.jti ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(verified.sid)
      )
        throw new Error("Invalid logout token");
      await store.revokeSid(verified.sid);
    } catch {
      throw failure(
        400,
        "CUSTOMER_PORTAL_LOGOUT_INVALID",
        "Invalid logout token",
      );
    }
    res.status(200).json({ status: "logged_out" });
  }
}
