/**
 * Workbench-only Nest composition; all shared behavior enters through public packages.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category module
 * @author AI-Generated
 * @date 2026-11-05
 */
import {
  Module,
  Inject,
  Controller,
  Get,
  type OnModuleInit,
} from "@nestjs/common";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import {
  ActiveContextService,
  OrganizationService,
  GovernanceService,
  PgOrganizationRepository,
} from "@vxture/service-organization"; // ⚠️ 跨层引用: domain-owned membership reads.
import { PoolsModule } from "./pools.module";
import { CONFIG, PRIMARY_POOL, READ_POOL, REDIS } from "./tokens";
import type { WorkbenchConfig } from "./config";
import { SessionStore } from "./auth/session-store";
import { SessionService } from "./auth/session-service";
import { WorkbenchOidcClient } from "./auth/oidc-client";
import { AuthRouter } from "./auth/auth-router";
import { ApiRouter } from "./api-router";
import { AppActivityRouter } from "./app-activity-router";
import { InboxRouter } from "./inbox-router";
import { ScopeService } from "./scope-service";
import { CatalogService } from "./catalog-service";
import { ResourceOverview } from "./resource-overview";
import { DesktopRouter } from "./desktop/desktop.router";
import { DesktopSessionService } from "./desktop/desktop-session.service";
import { DesktopEnabledGuard } from "./desktop/enabled.guard";
import { DESKTOP_RUNTIME, createDesktopRuntime } from "./desktop/runtime";
import { WorkspaceReader } from "./desktop/workspace-reader";
import { ApplicationReader } from "./desktop/application-reader";
import { ResourceReader } from "./desktop/resource-reader";
import { BillingService, PgBillingRepository } from "@vxture/service-billing"; // ⚠️ 跨层引用: inject the existing read-only pool into domain readers.
import {
  MeteringReadService,
  PgMeteringReadRepository,
  ProductSeatService,
  PgProductSeatRepository,
} from "@vxture/service-subscription"; // ⚠️ 跨层引用: reuse canonical period-aware quota reads.

@Controller("healthz")
class HealthRouter implements OnModuleInit {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PRIMARY_POOL) private readonly primary: Pool,
    @Inject(READ_POOL) private readonly reporting: Pool,
  ) {}

  async onModuleInit(): Promise<void> {
    this.redis.on("error", () => {
      /* Connectivity failures surface through readiness without printing credentials. */
    });
    await this.redis.connect();
  }
  @Get()
  async health() {
    await Promise.all([
      this.redis.ping(),
      this.primary.query("select 1"),
      this.reporting.query("select 1"),
    ]);
    return { status: "ok", service: "workbench-bff" };
  }
}

// ============================================================================
// Factories avoid implicit constructor metadata in the production esbuild bundle.
// ============================================================================
@Module({
  imports: [PoolsModule],
  controllers: [
    DesktopRouter,
    AuthRouter,
    ApiRouter,
    InboxRouter,
    AppActivityRouter,
    HealthRouter,
  ],
  providers: [
    DesktopSessionService,
    DesktopEnabledGuard,
    {
      provide: OrganizationService,
      inject: [PRIMARY_POOL],
      useFactory: (pool: Pool) =>
        new OrganizationService(new PgOrganizationRepository(pool)),
    },
    {
      provide: DESKTOP_RUNTIME,
      inject: [
        CONFIG,
        REDIS,
        OrganizationService,
        ScopeService,
        CatalogService,
        READ_POOL,
        ResourceOverview,
      ],
      useFactory: (
        config: WorkbenchConfig,
        redis: Redis,
        organization: OrganizationService,
        scopes: ScopeService,
        catalog: CatalogService,
        pool: Pool,
        overview: ResourceOverview,
      ) =>
        config.desktop
          ? {
              ...createDesktopRuntime(config.desktop, redis),
              workspaces: new WorkspaceReader(organization, scopes),
              applications: new ApplicationReader(catalog, pool, scopes),
              resources: new ResourceReader(scopes, overview),
            }
          : null,
    },
    {
      provide: SessionStore,
      inject: [REDIS, CONFIG],
      useFactory: (redis: Redis, config: WorkbenchConfig) =>
        new SessionStore(redis, config),
    },
    {
      provide: WorkbenchOidcClient,
      inject: [CONFIG],
      useFactory: (config: WorkbenchConfig) => new WorkbenchOidcClient(config),
    },
    {
      provide: SessionService,
      inject: [SessionStore, WorkbenchOidcClient, CONFIG],
      useFactory: (
        store: SessionStore,
        client: WorkbenchOidcClient,
        config: WorkbenchConfig,
      ) => new SessionService(store, client, config),
    },
    {
      provide: ScopeService,
      inject: [PRIMARY_POOL, OrganizationService],
      useFactory: (pool: Pool, organization: OrganizationService) => {
        const repository = new PgOrganizationRepository(pool);
        return new ScopeService(
          new ActiveContextService(repository),
          organization,
          new GovernanceService(repository),
        );
      },
    },
    {
      provide: CatalogService,
      inject: [READ_POOL],
      useFactory: (pool: Pool) =>
        new CatalogService(
          pool,
          new ProductSeatService(new PgProductSeatRepository(pool)),
        ),
    },
    {
      provide: ResourceOverview,
      inject: [READ_POOL],
      useFactory: (pool: Pool) =>
        new ResourceOverview(
          new MeteringReadService(new PgMeteringReadRepository(pool)),
          new BillingService(new PgBillingRepository(pool)),
        ),
    },
  ],
})
export class AppModule {}
