import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { VxConfigModule } from "@vxture/core-config";
import { MailModule } from "@vxture/core-mail";
import { AccountModule } from "@vxture/service-account";
import { IamModule } from "@vxture/service-iam";
import { OrganizationModule } from "@vxture/service-organization";
import { BillingModule } from "@vxture/service-billing";
import { PromotionModule } from "@vxture/service-promotion";
import { SubscriptionModule } from "@vxture/service-subscription";
import { SmsModule } from "@vxture/service-sms";
import { OidcRpModule } from "./oidc/oidc-rp.module";
import { ConsoleAuthService } from "./auth/auth.service";
import { S2sExchangeService } from "./auth/s2s-exchange.service";
import { SessionAggregator } from "./aggregators/session.aggregator";
import { PhoneChangeService } from "./services/phone-change.service";
import { EmailChangeService } from "./services/email-change.service";
import { PlatformEntitlementsClient } from "./platform/platform-entitlements.client";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { PermissionMiddleware } from "./middleware/permission.middleware";
import { TenantMiddleware } from "./middleware/tenant.middleware";
import { ApplicationsRouter } from "./routers/applications.router";
import { AtlasRouter } from "./routers/atlas.router";
import { BillingRouter } from "./routers/billing.router";
import { CapabilitiesRouter } from "./routers/capabilities.router";
import { HealthRouter } from "./routers/health.router";
import { IamRouter } from "./routers/iam.router";
import { MeRouter } from "./routers/me.router";
import { SearchRouter } from "./routers/search.router";
import { SubscriptionRouter } from "./routers/subscription.router";
import { TenantContextRouter } from "./routers/tenant-context.router";

@Module({
  imports: [
    VxConfigModule.register({
      domains: ["app", "auth", "database", "redis", "platform"],
    }),
    MailModule,
    AccountModule,
    IamModule,
    OrganizationModule,
    BillingModule,
    PromotionModule,
    SubscriptionModule,
    SmsModule,
    OidcRpModule,
  ],
  controllers: [
    ApplicationsRouter,
    HealthRouter,
    MeRouter,
    CapabilitiesRouter,
    TenantContextRouter,
    IamRouter,
    SubscriptionRouter,
    BillingRouter,
    AtlasRouter,
    SearchRouter,
  ],
  providers: [
    ConsoleAuthService,
    SessionAggregator,
    PhoneChangeService,
    EmailChangeService,
    PlatformEntitlementsClient,
    S2sExchangeService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware, TenantMiddleware, PermissionMiddleware)
      .forRoutes({ path: "api/*path", method: RequestMethod.ALL });
  }
}
