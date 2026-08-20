/**
 * app.module.ts - Website BFF Root Module (Identity Platform).
 * @package @vxture/bff-website
 *
 * Auth is OIDC-RP only: AuthMiddleware resolves the RP session and enriches
 * req.user (+ req.tenantId = active_org). User reads go through AccountModule
 * (@vxture/service-account); OrganizationModule (@vxture/service-organization)
 * supplies the active-org role + tenant type that the header user menu badges
 * render. The legacy HS256 stack + /api/auth/* seam and TenantMiddleware are
 * retired.
 */

import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { VxConfigModule } from "@vxture/core-config";
import { AccountModule } from "@vxture/service-account";
import { OrganizationModule } from "@vxture/service-organization";
import { WebsiteAuthService } from "./auth/auth.service";
import { SessionAggregator } from "./aggregators/session.aggregator";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { HealthRouter } from "./routers/health.router";
import { MeRouter } from "./routers/me.router";
import { ProductSubscriptionsRouter } from "./routers/product-subscriptions.router";
import { ProductCatalogRouter } from "./routers/product-catalog.router";
import { ProductPlansRouter } from "./routers/product-plans.router";
import { websiteBffPoolProvider } from "./providers/pg-pool.provider";
import { OidcRpModule } from "./oidc/oidc-rp.module";

@Module({
  imports: [
    VxConfigModule.register({
      domains: ["app", "auth", "database", "redis", "platform"],
    }),
    AccountModule,
    OrganizationModule,
    OidcRpModule,
  ],
  controllers: [
    HealthRouter,
    MeRouter,
    ProductSubscriptionsRouter,
    ProductCatalogRouter,
    ProductPlansRouter,
  ],
  providers: [WebsiteAuthService, SessionAggregator, websiteBffPoolProvider],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes({ path: "api/(.*)", method: RequestMethod.ALL });
  }
}
