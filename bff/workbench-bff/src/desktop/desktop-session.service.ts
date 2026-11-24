/**
 * desktop-session.service.ts - Native approval and RP session orchestration.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category service
 * @author AI-Generated
 * @date 2026-11-22
 */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
// ⚠️ 跨层引用: Identity verification and storage remain in shared RP components.
import {
  checkOidcSession,
  rpAuthFailure,
  generatePkce,
  mapAccessClaims,
  randomToken,
  type RpSession,
  type RpUser,
} from "@vxture/core-oidc-rp";
import { createHash } from "node:crypto";
import type { Request } from "express";
import {
  DESKTOP_RUNTIME,
  PENDING_TTL_SEC,
  type DesktopRuntime,
} from "./runtime";

const HANDLE = /^[0-9a-f]{64}$/;
const SCOPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PendingRequest {
  verifier: string;
  nonce: string;
  handle: string;
  deadline: number;
  tenantId?: string;
  workspaceId?: string;
}

interface DesktopRpSession extends RpSession {
  desktopScope: { tenantId: string | null; workspaceId: string | null };
}

function badRequest(): never {
  throw new BadRequestException({
    code: "NATIVE_REQUEST_INVALID",
    message: "Invalid desktop login request",
  });
}

// ============================================================================
// Opaque request credentials and verified identity
// ============================================================================

export function nativeSessionHeader(req: Request): string {
  const count = req.rawHeaders.filter(
    (name, i) => i % 2 === 0 && name.toLowerCase() === "x-vxture-session",
  ).length;
  const value = req.headers["x-vxture-session"];
  if (
    count !== 1 ||
    typeof value !== "string" ||
    !value ||
    value.length > 512 ||
    /[\s,]/.test(value)
  )
    badRequest();
  return value;
}

@Injectable()
export class DesktopSessionService {
  constructor(
    @Inject(DESKTOP_RUNTIME) private readonly runtime: DesktopRuntime | null,
  ) {}
  private get rt(): DesktopRuntime {
    if (!this.runtime) throw new NotFoundException();
    return this.runtime;
  }

  private key(kind: string, value: string): string {
    return `${this.rt.config.keyPrefix}rp:${this.rt.config.oidc.clientId}:native:${kind}:${value}`;
  }

  private identity(
    claims: Record<string, unknown>,
    expected?: { sub: string; sid: string },
  ): RpUser {
    const user = mapAccessClaims(claims);
    if (
      claims.iss !== this.rt.config.oidc.issuer ||
      claims.aud !== this.rt.config.oidc.clientId ||
      typeof claims.exp !== "number" ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Date.now() / 1000 ||
      !user.sub.startsWith("usr_") ||
      !user.userId ||
      typeof claims.sid !== "string" ||
      !claims.sid ||
      user.userType !== "tenant_user" ||
      (expected && (expected.sub !== user.sub || expected.sid !== claims.sid))
    )
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "No active desktop session",
      });
    if (user.accountStatus !== "active")
      throw new ForbiddenException({
        code: "ACCOUNT_UNAVAILABLE",
        message: "This account is not available",
      });
    return user;
  }

  async resolve(
    rpsid: string,
  ): Promise<{ user: RpUser; claims: Record<string, unknown> }> {
    const result = await this.rt.auth.resolve(rpsid);
    if (result.status === "unavailable")
      throw new ServiceUnavailableException(rpAuthFailure(result));
    if (result.status !== "ok")
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "No active desktop session",
      });
    const record = (await this.rt.store.get(rpsid)) as DesktopRpSession | null;
    if (!record) throw new UnauthorizedException();
    const user = this.identity(result.claims, record);
    if (
      !record.desktopScope ||
      record.desktopScope.tenantId !== user.activeOrg ||
      record.desktopScope.workspaceId !== user.activeWorkspace
    )
      throw new ConflictException({
        code: "SESSION_SCOPE_CHANGED",
        message: "The session workspace changed; select the workspace again",
      });
    return {
      user,
      claims: result.claims,
    };
  }

  async current(
    rpsid: string,
  ): Promise<{ user: RpUser; claims: Record<string, unknown> }> {
    const identity = await this.resolve(rpsid);
    let valid: boolean;
    try {
      valid = await checkOidcSession(
        this.rt.config.oidc,
        String(identity.claims.sid),
      );
    } catch {
      throw new BadGatewayException({
        code: "SESSION_CHECK_UNAVAILABLE",
        message: "Session verification is temporarily unavailable",
      });
    }
    if (!valid) {
      await this.rt.store.destroy(rpsid);
      throw new UnauthorizedException();
    }
    // A revocation or replacement while the central check awaited must win.
    return this.resolve(rpsid);
  }

  // ========================================================================
  // Browser approval and one-time native claim
  // ========================================================================

  async begin(url: URL): Promise<string> {
    const allowed = new Set([
      "surface",
      "handle",
      "prompt",
      "tenantId",
      "workspaceId",
      "ui_locales",
    ]);
    for (const name of url.searchParams.keys())
      if (!allowed.has(name) || url.searchParams.getAll(name).length !== 1)
        badRequest();
    const handle = url.searchParams.get("handle");
    const prompt = url.searchParams.get("prompt");
    const locale = url.searchParams.get("ui_locales");
    if (
      url.searchParams.get("surface") !== "native" ||
      !handle ||
      !HANDLE.test(handle) ||
      (prompt !== null && prompt !== "select_account") ||
      (locale !== null && !["zh-CN", "en"].includes(locale))
    )
      badRequest();
    const tenantId = url.searchParams.get("tenantId"),
      workspaceId = url.searchParams.get("workspaceId");
    if (
      (tenantId !== null && !SCOPE.test(tenantId)) ||
      (workspaceId !== null && !SCOPE.test(workspaceId))
    )
      badRequest();
    const state = randomToken(),
      nonce = randomToken(),
      pkce = generatePkce();
    const reservation = await this.rt.redis.set(
      this.key("handle", handle),
      state,
      "EX",
      PENDING_TTL_SEC,
      "NX",
    );
    if (reservation !== "OK")
      throw new ConflictException({
        code: "NATIVE_LOGIN_EXISTS",
        message: "Start a new desktop login",
      });
    const pending: PendingRequest = {
      verifier: pkce.verifier,
      nonce,
      handle,
      deadline: Date.now() + PENDING_TTL_SEC * 1000,
      ...(tenantId ? { tenantId: tenantId.toLowerCase() } : {}),
      ...(workspaceId ? { workspaceId: workspaceId.toLowerCase() } : {}),
    };
    await this.rt.redis.setex(
      this.key("request", state),
      PENDING_TTL_SEC,
      JSON.stringify(pending),
    );
    return this.rt.client.buildAuthorizeUrl({
      state,
      nonce,
      codeChallenge: pkce.challenge,
      ...(prompt ? { prompt } : {}),
      ...(locale ? { uiLocales: locale } : {}),
      ...(pending.tenantId ? { tenantHint: pending.tenantId } : {}),
      ...(pending.workspaceId ? { workspaceHint: pending.workspaceId } : {}),
    });
  }

  async callback(url: URL): Promise<void> {
    if (
      [...url.searchParams.keys()].some(
        (name) =>
          !["state", "code", "error", "error_description", "iss"].includes(
            name,
          ) || url.searchParams.getAll(name).length !== 1,
      )
    )
      badRequest();
    const state = url.searchParams.get("state"),
      code = url.searchParams.get("code");
    if (!state || !/^[A-Za-z0-9_-]{20,128}$/.test(state)) badRequest();
    const raw = await this.rt.redis.getdel(this.key("request", state));
    if (!raw) badRequest();
    const pending = JSON.parse(raw) as PendingRequest;
    if (
      pending.deadline <= Date.now() ||
      url.searchParams.has("error") ||
      !code ||
      code.length > 4096 ||
      (url.searchParams.has("iss") &&
        url.searchParams.get("iss") !== this.rt.config.oidc.issuer)
    )
      badRequest();
    let session: DesktopRpSession;
    try {
      const tokens = await this.rt.client.exchangeCode({
        code,
        codeVerifier: pending.verifier,
      });
      const id = await this.rt.client.verifyIdToken(
        tokens.idToken,
        pending.nonce,
      );
      const claims = await this.rt.client.verifyAccessToken(tokens.accessToken);
      const user = this.identity(claims, id);
      if (
        !Number.isFinite(id.exp) ||
        id.exp <= Date.now() / 1000 ||
        !tokens.refreshToken ||
        (pending.tenantId && user.activeOrg !== pending.tenantId) ||
        (pending.workspaceId &&
          (user.activeWorkspace !== pending.workspaceId ||
            !user.roles.some((role) => role.startsWith("workspace:"))))
      )
        throw new Error("Identity or requested scope mismatch");
      session = {
        ...tokens,
        sub: id.sub,
        sid: id.sid,
        activeOrg: user.activeOrg,
        desktopScope: {
          tenantId: user.activeOrg,
          workspaceId: user.activeWorkspace,
        },
      };
    } catch {
      throw new UnauthorizedException({
        code: "NATIVE_APPROVAL_REJECTED",
        message: "Desktop login could not be verified",
      });
    }
    const ttl = Math.floor((pending.deadline - Date.now()) / 1000);
    if (ttl <= 0) badRequest();
    // Tokens stay in a short-lived, server-only approval until native claim.
    // Creating RP sessions only on claim keeps their shared sid index TTL uniform.
    const bound = await this.rt.redis.set(
      this.key("pending", pending.handle),
      JSON.stringify(session),
      "EX",
      ttl,
      "NX",
    );
    if (bound !== "OK")
      throw new ConflictException("Native approval already bound");
  }

  async claim(body: unknown): Promise<{ rpsid: string; expiresInSec: number }> {
    const secret =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).deviceSecret
        : undefined;
    if (typeof secret !== "string" || !HANDLE.test(secret)) badRequest();
    const handle = createHash("sha256").update(secret).digest("hex");
    const raw = await this.rt.redis.getdel(this.key("pending", handle));
    if (!raw)
      throw new NotFoundException({
        code: "NATIVE_NOT_READY",
        message: "No desktop approval is ready",
        retryable: true,
      });
    const session = JSON.parse(raw) as RpSession;
    const rpsid = randomToken();
    try {
      await this.rt.store.create(
        rpsid,
        session,
        this.rt.config.oidc.sessionTtlSec,
      );
      await this.current(rpsid);
      return { rpsid, expiresInSec: this.rt.config.oidc.sessionTtlSec };
    } catch (error) {
      await this.rt.store.destroy(rpsid);
      throw error;
    }
  }
}
