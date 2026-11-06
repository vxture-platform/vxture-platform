/**
 * Browser-bound authorization, explicit context switching and central logout.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-05
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { Controller, Get, Post, Inject, Req, Res } from "@nestjs/common";
import type { CookieOptions, Request, Response } from "express";
import {
  generatePkce,
  randomToken,
  mapAccessClaims,
} from "@vxture/core-oidc-rp"; // ⚠️ 跨层引用: use platform PKCE and cryptographic randomness.
import { failure } from "../errors";
import type { WorkbenchConfig } from "../config";
import { ScopeService } from "../scope-service";
import { SessionStore } from "./session-store";
import { WorkbenchOidcClient, validateBinding } from "./oidc-client";
import { SessionService } from "./session-service";
import { CONFIG } from "../tokens";

interface AuthRequest {
  nonce: string;
  verifier: string;
  binding: string;
  returnTo: string;
  userId?: string;
  tenantId?: string;
  workspaceId?: string;
}
const HANDLE = /^[A-Za-z0-9_-]{32,128}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function parameter(req: Request, name: string): string | undefined {
  const query = new URL(req.originalUrl, "http://localhost").searchParams;
  if (
    query.getAll(name).length > 1 ||
    [...query.keys()].some((key) => key.startsWith(`${name}[`))
  )
    throw failure(
      400,
      "WORKBENCH_REQUEST_INVALID",
      "Ambiguous authorization parameters",
    );
  const value: unknown = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 4096)
    throw failure(
      400,
      "WORKBENCH_REQUEST_INVALID",
      "Invalid authorization parameters",
    );
  return value;
}
function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

@Controller("auth")
export class AuthRouter {
  constructor(
    @Inject(CONFIG) private readonly config: WorkbenchConfig,
    @Inject(SessionStore) private readonly store: SessionStore,
    @Inject(WorkbenchOidcClient) private readonly client: WorkbenchOidcClient,
    @Inject(SessionService) private readonly auth: SessionService,
    @Inject(ScopeService) private readonly scopes: ScopeService,
  ) {}

  // ========================================================================
  // Browser navigation and one-time authorization requests
  // ========================================================================
  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.secure,
      sameSite: "lax",
      path: "/",
    };
  }
  private stateCookie(state: string): string {
    return `${this.config.secure ? "__Host-" : ""}vx_workbench_auth_${state}`;
  }
  private destination(req: Request): string {
    try {
      const url = new URL(
        parameter(req, "returnTo") ?? "/",
        this.config.origin,
      );
      if (
        url.origin === this.config.origin &&
        !url.username &&
        !url.password &&
        ["/", "/apps"].includes(url.pathname)
      )
        return url.href;
    } catch {
      /* Untrusted navigation falls back to the workbench home. */
    }
    return `${this.config.origin}/`;
  }
  private assertNavigation(req: Request): void {
    // Customer subdomains share a site, but must not control this RP's session.
    if (
      ["cross-site", "same-site"].includes(
        String(req.headers["sec-fetch-site"]),
      )
    )
      throw failure(
        403,
        "WORKBENCH_NAVIGATION_FORBIDDEN",
        "Open this action from the workbench",
      );
  }

  private async begin(
    req: Request,
    res: Response,
    hints: { userId?: string; tenantId?: string; workspaceId?: string } = {},
    prompt?: string,
  ): Promise<void> {
    const state = randomToken();
    const binding = randomToken();
    const nonce = randomToken();
    const pkce = generatePkce();
    const payload: AuthRequest = {
      nonce,
      verifier: pkce.verifier,
      binding: digest(binding),
      returnTo: this.destination(req),
      ...hints,
    };
    await this.store.redis.setex(
      `${this.store.prefix}authreq:${state}`,
      600,
      JSON.stringify(payload),
    );
    res.cookie(this.stateCookie(state), binding, {
      ...this.options(),
      maxAge: 600000,
    });
    res.redirect(
      this.client.buildAuthorizeUrl({
        state,
        nonce,
        codeChallenge: pkce.challenge,
        ...(prompt ? { prompt } : {}),
        ...(hints.tenantId ? { tenantHint: hints.tenantId } : {}),
        ...(hints.workspaceId ? { workspaceHint: hints.workspaceId } : {}),
      }),
    );
  }

  private async assertPortalAccount(
    req: Request,
    userId: string,
  ): Promise<void> {
    const currentId = this.auth.cookie(req);
    const current = currentId ? await this.store.read(currentId) : null;
    if (current && current.session.sub !== `usr_${userId}`)
      throw failure(
        409,
        "PORTAL_ACCOUNT_MISMATCH",
        "The target portal uses another account; switch accounts explicitly",
      );
  }

  @Get("login")
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    const prompt = parameter(req, "prompt");
    if (prompt && !["none", "login", "select_account"].includes(prompt))
      throw failure(400, "WORKBENCH_REQUEST_INVALID", "Invalid login prompt");
    const surface = parameter(req, "surface");
    const userId = parameter(req, "userId");
    const tenantId = parameter(req, "tenantId");
    const workspaceId = parameter(req, "workspaceId");
    if (surface === "portal") {
      if (
        prompt !== undefined ||
        !userId ||
        !UUID.test(userId) ||
        !tenantId ||
        !UUID.test(tenantId) ||
        !workspaceId ||
        !UUID.test(workspaceId)
      )
        throw failure(
          400,
          "WORKBENCH_REQUEST_INVALID",
          "Portal entry requires one account and exact workspace context",
        );
      await this.assertPortalAccount(req, userId.toLowerCase());
      await this.begin(req, res, {
        userId: userId.toLowerCase(),
        tenantId: tenantId.toLowerCase(),
        workspaceId: workspaceId.toLowerCase(),
      });
    } else {
      if (
        surface !== undefined ||
        userId !== undefined ||
        tenantId !== undefined ||
        workspaceId !== undefined
      )
        throw failure(
          400,
          "WORKBENCH_REQUEST_INVALID",
          "Unexpected portal context",
        );
      await this.begin(req, res, {}, prompt);
    }
  }

  @Get("callback")
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const state = parameter(req, "state");
    if (!state || !HANDLE.test(state))
      throw failure(
        400,
        "WORKBENCH_STATE_INVALID",
        "Invalid authorization state",
      );
    const cookie: unknown = (
      req.cookies as Record<string, unknown> | undefined
    )?.[this.stateCookie(state)];
    const raw = await this.store.redis.get(
      `${this.store.prefix}authreq:${state}`,
    );
    if (!raw || typeof cookie !== "string")
      throw failure(
        400,
        "WORKBENCH_STATE_INVALID",
        "Authorization did not originate in this browser",
      );
    const pending = JSON.parse(raw) as AuthRequest;
    const actual = digest(cookie);
    if (
      actual.length !== pending.binding.length ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(pending.binding))
    )
      throw failure(
        400,
        "WORKBENCH_STATE_INVALID",
        "Authorization browser binding mismatch",
      );
    if (
      (await this.store.redis.getdel(
        `${this.store.prefix}authreq:${state}`,
      )) !== raw
    )
      throw failure(
        400,
        "WORKBENCH_STATE_INVALID",
        "Authorization request already consumed",
      );
    res.clearCookie(this.stateCookie(state), this.options());
    if (parameter(req, "error"))
      throw failure(
        401,
        "WORKBENCH_LOGIN_FAILED",
        "Authorization was not completed",
      );
    const code = parameter(req, "code");
    if (!code)
      throw failure(
        400,
        "WORKBENCH_REQUEST_INVALID",
        "Missing authorization code",
      );
    const tokens = await this.client.exchangeCode({
      code,
      codeVerifier: pending.verifier,
    });
    const identity = await this.client.verifyIdToken(
      tokens.idToken,
      pending.nonce,
    );
    const access = await this.client.verifyAccessToken(tokens.accessToken);
    validateBinding(identity, access);
    if (pending.userId) {
      if (identity.sub !== `usr_${pending.userId}`)
        throw failure(
          403,
          "PORTAL_ACCOUNT_MISMATCH",
          "Central SSO returned a different account",
        );
      await this.assertPortalAccount(req, pending.userId);
      await this.scopes.assertCurrent(mapAccessClaims(access));
    }
    if (
      (pending.tenantId && access.active_org !== pending.tenantId) ||
      (pending.workspaceId && access.active_workspace !== pending.workspaceId)
    )
      throw failure(
        403,
        "WORKBENCH_CONTEXT_NOT_APPLIED",
        "The requested context was not applied",
      );
    const id = randomToken();
    const central = await this.client.centralStatus(identity.sid);
    if (!central.valid)
      throw failure(401, "WORKBENCH_LOGIN_REQUIRED", "Central session ended");
    await this.store.create(id, {
      ...tokens,
      sid: identity.sid,
      sub: identity.sub,
      org: access.active_org as string,
      workspace: access.active_workspace as string,
      expiresAt: Math.floor(Date.now() / 1000) + this.config.oidc.sessionTtlSec,
      nextCheckAt: central.nextCheckAt,
    });
    const old = this.auth.cookie(req);
    if (old) await this.store.destroy(old);
    res.cookie(this.config.cookieName, id, {
      ...this.options(),
      maxAge: this.config.oidc.sessionTtlSec * 1000,
    });
    res.redirect(pending.returnTo);
  }

  @Get("session")
  async session(@Req() req: Request) {
    const current = await this.auth.authenticate(req);
    return { status: "active", userId: current.user.userId };
  }

  @Get("switch-tenant")
  async switchTenant(@Req() req: Request, @Res() res: Response): Promise<void> {
    this.assertNavigation(req);
    const { user } = await this.auth.authenticate(req);
    const tenantId = parameter(req, "tenantId");
    const workspaceId = parameter(req, "workspaceId");
    if (
      !tenantId ||
      !UUID.test(tenantId) ||
      (workspaceId !== undefined && !UUID.test(workspaceId)) ||
      !(await this.scopes.canSwitch(user, tenantId, workspaceId))
    )
      throw failure(
        403,
        "WORKBENCH_SCOPE_FORBIDDEN",
        "Organization is not accessible",
      );
    await this.begin(
      req,
      res,
      { tenantId, ...(workspaceId ? { workspaceId } : {}) },
      "none",
    );
  }

  @Get("switch-workspace")
  async switchWorkspace(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.assertNavigation(req);
    const { user } = await this.auth.authenticate(req);
    const workspaceId = parameter(req, "workspaceId");
    if (
      !workspaceId ||
      !UUID.test(workspaceId) ||
      !(await this.scopes.canSwitch(user, undefined, workspaceId))
    )
      throw failure(
        403,
        "WORKBENCH_SCOPE_FORBIDDEN",
        "Workspace is not accessible",
      );
    await this.begin(
      req,
      res,
      { tenantId: user.activeOrg!, workspaceId },
      "none",
    );
  }

  // ========================================================================
  // Central and back-channel logout
  // ========================================================================
  private async end(
    req: Request,
    res: Response,
    switchUser: boolean,
  ): Promise<void> {
    this.assertNavigation(req);
    const id = this.auth.cookie(req);
    if (id) await this.store.destroy(id);
    res.clearCookie(this.config.cookieName, this.options());
    const state = randomToken();
    const binding = randomToken();
    await this.store.redis.setex(
      `${this.store.prefix}logoutreq:${state}`,
      600,
      JSON.stringify({ binding: digest(binding), switchUser }),
    );
    res.cookie(this.stateCookie(state), binding, {
      ...this.options(),
      maxAge: 600000,
    });
    res.redirect(
      this.client.buildEndSessionUrl({
        postLogoutRedirectUri: `${this.config.origin}/auth/signed-out`,
        state,
      }),
    );
  }
  @Get("logout")
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.end(req, res, false);
  }
  @Get("switch")
  async switch(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.end(req, res, true);
  }

  @Get("signed-out")
  async signedOut(@Req() req: Request, @Res() res: Response): Promise<void> {
    const state = parameter(req, "state");
    const cookie: unknown =
      state && HANDLE.test(state)
        ? (req.cookies as Record<string, unknown> | undefined)?.[
            this.stateCookie(state)
          ]
        : undefined;
    if (!state || typeof cookie !== "string")
      throw failure(400, "WORKBENCH_STATE_INVALID", "Invalid logout state");
    const key = `${this.store.prefix}logoutreq:${state}`;
    const raw = await this.store.redis.get(key);
    if (!raw)
      throw failure(400, "WORKBENCH_STATE_INVALID", "Logout state expired");
    const pending = JSON.parse(raw) as { binding: string; switchUser: boolean };
    if (
      digest(cookie) !== pending.binding ||
      (await this.store.redis.getdel(key)) !== raw
    )
      throw failure(
        400,
        "WORKBENCH_STATE_INVALID",
        "Invalid logout browser binding",
      );
    res.clearCookie(this.stateCookie(state), this.options());
    if (pending.switchUser) await this.begin(req, res, {}, "login");
    else res.redirect(`${this.config.origin}/`);
  }

  @Post("backchannel-logout")
  async backchannel(@Req() req: Request, @Res() res: Response): Promise<void> {
    const body: unknown = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      !("logout_token" in body) ||
      typeof body.logout_token !== "string"
    )
      throw failure(400, "WORKBENCH_LOGOUT_INVALID", "Missing logout token");
    let sid: string;
    try {
      ({ sid } = await this.client.verifyLogoutToken(body.logout_token));
      const payload: unknown = JSON.parse(
        Buffer.from(body.logout_token.split(".")[1]!, "base64url").toString(
          "utf8",
        ),
      );
      if (
        !payload ||
        typeof payload !== "object" ||
        !("exp" in payload) ||
        typeof payload.exp !== "number" ||
        !Number.isFinite(payload.exp) ||
        payload.exp <= Date.now() / 1000 ||
        !("iat" in payload) ||
        typeof payload.iat !== "number" ||
        !Number.isFinite(payload.iat) ||
        payload.iat > Date.now() / 1000 + 60 ||
        !("jti" in payload) ||
        typeof payload.jti !== "string" ||
        !payload.jti ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(sid)
      )
        throw new Error("Invalid logout lifetime");
    } catch {
      throw failure(400, "WORKBENCH_LOGOUT_INVALID", "Invalid logout token");
    }
    await this.store.revokeSid(sid);
    res.status(200).json({ status: "logged_out" });
  }
}
