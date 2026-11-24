/**
 * Trusted host resolution and live authorization shared by every private route.
 * @package @vxture/bff-tenant
 * @layer Application
 * @category auth
 * @author AI-Generated
 * @date 2026-11-15
 */
import { timingSafeEqual } from "node:crypto";
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import type { Redis } from "ioredis";
import type {
  CustomerPortalService,
  PortalAccessService,
} from "@vxture/service-customer-portal"; // ⚠️ 跨层引用: delegate binding and membership decisions to the domain.
import {
  customerHost,
  runtimeFor,
  type PortalConfig,
  type PortalRuntime,
} from "./config";
import { identitySync } from "./auth/identity-sync";
import type { IdentitySyncRuntime } from "@vxture/core-oidc-rp";
import { SessionStore } from "./auth/session-store";
import { SessionService } from "./auth/session-service";
import { PortalOidcClient } from "./auth/oidc-client";
import { failure } from "./errors";

export interface PortalContext {
  runtime: PortalRuntime;
  store: SessionStore;
  client: PortalOidcClient;
  sessions: SessionService;
}

/** Resolve the portal on every request, so a disabled or reassigned binding fails closed. */
export class PortalGateway {
  readonly sync: IdentitySyncRuntime;
  constructor(
    private readonly config: PortalConfig,
    private readonly redis: Redis,
    readonly portals: CustomerPortalService,
    private readonly access: PortalAccessService,
  ) {
    this.sync = identitySync(
      { ...config.oidc, redirectUri: "https://unused.invalid/auth/callback" },
      redis,
    );
  }
  async onModuleInit(): Promise<void> {
    await this.sync.onModuleInit();
  }
  async onModuleDestroy(): Promise<void> {
    await this.sync.onModuleDestroy();
  }

  async context(req: Request): Promise<PortalContext> {
    const token = req.headers["x-customer-portal-token"];
    if (
      typeof token !== "string" ||
      Buffer.byteLength(token) !== Buffer.byteLength(this.config.proxyToken) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(this.config.proxyToken))
    )
      throw failure(
        403,
        "CUSTOMER_PORTAL_PROXY_REQUIRED",
        "Trusted portal proxy required",
      );
    let hostname: string;
    try {
      hostname = customerHost(req.headers["x-customer-portal-host"]);
    } catch {
      throw failure(404, "CUSTOMER_PORTAL_NOT_FOUND", "门户不存在");
    }
    const binding = await this.portals.published(hostname);
    const runtime = runtimeFor(this.config, binding);
    const store = new SessionStore(this.redis, runtime, this.sync);
    const client = new PortalOidcClient(runtime);
    return {
      runtime,
      store,
      client,
      sessions: new SessionService(store, client, runtime),
    };
  }

  async assertMember(
    context: PortalContext,
    user: Parameters<PortalAccessService["assertMember"]>[1],
  ) {
    return this.access.assertMember(context.runtime.binding, user);
  }

  async authenticate(req: Request, context: PortalContext) {
    const current = await context.sessions.authenticate(req);
    try {
      const member = await this.assertMember(context, current.user);
      return { ...current, member };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 403)
        await context.store.destroy(current.id);
      throw error;
    }
  }
}
