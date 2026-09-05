import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
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
import { CapabilityGuard } from "./auth/capability";
import { S2sExchangeService } from "./auth/s2s-exchange.service";
import { SessionAggregator } from "./aggregators/session.aggregator";
import { AccountDeletionAggregator } from "./aggregators/account-deletion.aggregator";
import { TenantClosureAggregator } from "./aggregators/tenant-closure.aggregator";
import { PhoneChangeService } from "./services/phone-change.service";
import { EmailChangeService } from "./services/email-change.service";
import { customerNotificationsProvider } from "./services/customer-notifications.wiring";
import { PlatformEntitlementsClient } from "./platform/platform-entitlements.client";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { PermissionMiddleware } from "./middleware/permission.middleware";
import { TenantMiddleware } from "./middleware/tenant.middleware";
import { ApplicationsRouter } from "./routers/applications.router";
import { AuditRouter } from "./routers/audit.router";
import { AtlasRouter } from "./routers/atlas.router";
import { BillingRouter } from "./routers/billing.router";
import { CapabilitiesRouter } from "./routers/capabilities.router";
import { HealthRouter } from "./routers/health.router";
import { IamRouter } from "./routers/iam.router";
import { InboxRouter } from "./routers/inbox.router";
import { MeRouter } from "./routers/me.router";
import { PromotionRouter } from "./routers/promotion.router";
import { QuotaRouter } from "./routers/quota.router";
import { SearchRouter } from "./routers/search.router";
import { SubscriptionRouter } from "./routers/subscription.router";
import { TenantContextRouter } from "./routers/tenant-context.router";
import { UsageRouter } from "./routers/usage.router";
import { VerificationRouter } from "./routers/verification.router";

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
    InboxRouter,
    CapabilitiesRouter,
    TenantContextRouter,
    IamRouter,
    SubscriptionRouter,
    BillingRouter,
    QuotaRouter,
    PromotionRouter,
    UsageRouter,
    VerificationRouter,
    AuditRouter,
    AtlasRouter,
    SearchRouter,
  ],
  providers: [
    ConsoleAuthService,
    SessionAggregator,
    AccountDeletionAggregator,
    TenantClosureAggregator,
    PhoneChangeService,
    EmailChangeService,
    // P2-g：客户通知（站内 + 邮件）挂到 OrderService / SubscriptionService
    customerNotificationsProvider,
    PlatformEntitlementsClient,
    S2sExchangeService,
    // 批 0a:每条路由必须声明访问策略(@Public / @SelfScope / @RequireCapability),
    // 漏标即 403——默认拒绝,不默认放行。
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware, TenantMiddleware, PermissionMiddleware)
      .forRoutes({ path: "api/*path", method: RequestMethod.ALL });
  }
}
