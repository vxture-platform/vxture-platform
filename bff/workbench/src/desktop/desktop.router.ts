/**
 * desktop.router.ts - Minimal native session and verified identity endpoints.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category router
 * @author AI-Generated
 * @date 2026-11-22
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Param,
  NotFoundException,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
// ⚠️ 跨层引用: Use the platform's single public health identity implementation.
import { buildHealthIdentity } from "@vxture-platform/shared";
import {
  DesktopSessionService,
  nativeSessionHeader,
} from "./desktop-session.service";
import { DESKTOP_RUNTIME, type DesktopRuntime } from "./runtime";
import { DesktopEnabledGuard } from "./enabled.guard";
import { requireWorkspaceReader } from "./workspace-reader";
import { requireApplicationReader } from "./application-reader";
import { requireResourceReader } from "./resource-reader";
import { failure } from "../errors";

const DONE_HTML =
  '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RUYIN</title><body><main><h1>登录已完成</h1><p>请返回 RUYIN 桌面应用继续。</p></main></body></html>';

@Controller("desktop")
@UseGuards(DesktopEnabledGuard)
export class DesktopRouter {
  constructor(
    @Inject(DesktopSessionService)
    private readonly sessions: DesktopSessionService,
    @Inject(DESKTOP_RUNTIME) private readonly runtime: DesktopRuntime | null,
  ) {}

  private get rt(): DesktopRuntime {
    if (!this.runtime) throw new NotFoundException();
    return this.runtime;
  }

  @Get("health")
  health(): { status: string } {
    return { status: "ok" };
  }

  /** Dependency-free liveness and build provenance (platform standards 020/025). */
  @Get("healthz")
  @Header("Cache-Control", "no-store")
  healthIdentity() {
    return buildHealthIdentity({ service: "workbench-bff", product: "vxture" });
  }

  @Get("auth/login")
  @Header("Cache-Control", "no-store")
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    const authorize = await this.sessions.begin(
      new URL(req.originalUrl, this.rt.config.base),
    );
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(authorize);
  }

  @Get("auth/callback")
  @Header("Cache-Control", "no-store")
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader("Referrer-Policy", "no-referrer");
    await this.sessions.callback(new URL(req.originalUrl, this.rt.config.base));
    res.redirect(`${this.rt.config.base}/auth/native/done`);
  }

  @Get("auth/native/done")
  @Header("Cache-Control", "no-store")
  @Header(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  )
  @Header("Referrer-Policy", "no-referrer")
  @Header("X-Content-Type-Options", "nosniff")
  @Header("Content-Type", "text/html; charset=utf-8")
  done(): string {
    return DONE_HTML;
  }

  @Post("auth/native/claim")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  claim(
    @Body() body: unknown,
  ): Promise<{ rpsid: string; expiresInSec: number }> {
    return this.sessions.claim(body);
  }

  @Post("auth/native/logout")
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async logout(@Req() req: Request): Promise<void> {
    await this.rt.store.destroy(nativeSessionHeader(req));
  }

  @Post("auth/backchannel-logout")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async backchannelLogout(
    @Body() body: { logout_token?: unknown } | undefined,
  ): Promise<{ status: string }> {
    if (typeof body?.logout_token !== "string")
      throw new BadRequestException("A logout token is required");
    let sid: string;
    try {
      ({ sid } = await this.rt.client.verifyLogoutToken(body.logout_token));
    } catch {
      throw new BadRequestException("Invalid logout token");
    }
    if (!sid)
      throw new BadRequestException("Session-specific logout is required");
    await this.rt.store.destroyBySid(sid);
    return { status: "ok" };
  }

  @Get("api/me")
  @Header("Cache-Control", "no-store")
  async me(@Req() req: Request): Promise<Record<string, unknown>> {
    const { user } = await this.sessions.current(nativeSessionHeader(req));
    return {
      id: user.userId,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      avatarUrl: user.picture,
      accountStatus: user.accountStatus,
    };
  }

  @Get("api/tenant-context")
  @Header("Cache-Control", "no-store")
  async context(@Req() req: Request): Promise<Record<string, unknown>> {
    const { user } = await this.sessions.current(nativeSessionHeader(req));
    // Identity login can work without a query source; project access cannot.
    // A default workspace claim alone is not proof of workspace membership.
    const { organization, spaces } = await requireWorkspaceReader(
      this.rt.workspaces,
    ).current(user);
    return {
      mode: "tenant",
      id: user.activeOrg,
      name: organization.displayName?.trim() || organization.name,
      tenantType: organization.type,
      workspace: user.activeWorkspace,
      workspaceName: spaces.find((space) => space.id === user.activeWorkspace)!
        .name,
    };
  }

  @Get("api/me/workspaces")
  @Header("Cache-Control", "no-store")
  async workspaces(@Req() req: Request) {
    const { user } = await this.sessions.current(nativeSessionHeader(req));
    return requireWorkspaceReader(this.rt.workspaces).all(user);
  }

  @Get("api/iam/workspaces/mine")
  @Header("Cache-Control", "no-store")
  async myWorkspaces(@Req() req: Request) {
    const { user } = await this.sessions.current(nativeSessionHeader(req));
    return requireWorkspaceReader(this.rt.workspaces).mine(user);
  }

  @Get("api/me/organization")
  @Header("Cache-Control", "no-store")
  async organization(@Req() req: Request) {
    const { user } = await this.sessions.current(nativeSessionHeader(req));
    const { organization: org } = await requireWorkspaceReader(
      this.rt.workspaces,
    ).current(user);
    return {
      tenantId: org.id,
      tenantName: org.name,
      displayName: org.displayName ?? null,
    };
  }

  @Get("api/subscription/subscribed-products")
  @Header("Cache-Control", "no-store")
  async subscribedProducts(@Req() req: Request) {
    const rpsid = nativeSessionHeader(req);
    const { user } = await this.sessions.current(rpsid);
    await requireWorkspaceReader(this.rt.workspaces).current(user);
    const rows = await requireApplicationReader(
      this.rt.applications,
    ).subscribed(user);
    // A local logout or scope change during the read must win over its result.
    await this.sessions.resolve(rpsid);
    return rows;
  }

  @Get("api/subscription/quota-usage")
  @Header("Cache-Control", "private, no-store")
  async quotaUsage(@Req() req: Request) {
    try {
      const rpsid = nativeSessionHeader(req);
      const { user } = await this.sessions.current(rpsid);
      const usage = await requireResourceReader(this.rt.resources).quotaUsage(
        user,
      );
      await this.sessions.resolve(rpsid);
      return usage;
    } catch (error) {
      // Legacy native auth errors lack retryability; this new read uses the envelope.
      if (error instanceof HttpException) {
        const body = error.getResponse();
        if (
          typeof body === "object" &&
          body !== null &&
          "code" in body &&
          "message" in body &&
          typeof body.code === "string" &&
          typeof body.message === "string"
        )
          throw failure(error.getStatus(), body.code, body.message);
      }
      throw error;
    }
  }

  /** Public branding only; no desktop or browser session is required. */
  @Get("api/applications/:appCode/icon")
  async productIcon(
    @Param("appCode") code: string,
    @Res({ passthrough: true }) res: Response,
    @Headers("if-none-match") ifNoneMatch?: string,
  ): Promise<StreamableFile | undefined> {
    const row = await requireApplicationReader(this.rt.applications).icon(code);
    if (!row) throw new NotFoundException("No icon");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(row.mime_type) ||
      row.bytes.length === 0 ||
      row.bytes.length > 262144
    )
      throw new ServiceUnavailableException("Product icon unavailable");
    const etag = `"${row.checksum}"`;
    res.set({
      "Content-Type": row.mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    });
    if (ifNoneMatch === etag) {
      res.status(304);
      return undefined;
    }
    return new StreamableFile(row.bytes);
  }
}
