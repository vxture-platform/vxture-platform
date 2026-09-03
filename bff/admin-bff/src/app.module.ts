import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { VxConfigModule } from "@vxture/core-config";
import { MailModule } from "@vxture/core-mail";
import { AdminBffPoolsModule } from "./providers/pools.module";
import {
  addonServiceProvider,
  commerceServicesProvider,
  orderServiceProvider,
  promotionServiceProvider,
} from "./providers/commerce-services.provider";
import { OidcRpModule } from "./oidc/oidc-rp.module";
import { PlatformAuthService } from "./auth/auth.service";
import { OperatorExchangeService } from "./auth/operator-exchange.service";
import { OperatorStepUpService } from "./auth/operator-stepup.service";
import { OperatorAdminService } from "./auth/operator-admin.service";
import { OperatorStepUpGuard } from "./auth/step-up.guard";
import { SessionAggregator } from "./aggregators/session.aggregator";
import { AuthMiddleware } from "./middleware/auth.middleware";
import { PermissionMiddleware } from "./middleware/permission.middleware";
import { AdminPermissionsRouter } from "./routers/admin-permissions.router";
import { AdminRolesRouter } from "./routers/admin-roles.router";
import { AtlasRouter } from "./routers/atlas.router";
import { RunosRouter } from "./routers/runos.router";
import { AnnouncementsRouter } from "./routers/announcements.router";
import { AuditLogsRouter } from "./routers/audit-logs.router";
import { AuthRouter } from "./routers/auth.router";
import { CapabilitiesRouter } from "./routers/capabilities.router";
import { HealthRouter } from "./routers/health.router";
import { MeRouter } from "./routers/me.router";
import { OperatorStepUpRouter } from "./routers/operator-stepup.router";
import { PlatformAdminsRouter } from "./routers/platform-admins.router";
import { ApplicationsRouter } from "./routers/applications.router";
import { ProductsRouter } from "./routers/products.router";
import { TicketsRouter } from "./routers/tickets.router";
import { TenantsRouter } from "./routers/tenants.router";
import { AccountsRouter } from "./routers/accounts.router";
import { BillingRouter } from "./routers/billing.router";
import { InvoicesRouter } from "./routers/invoices.router";
import { AddonOrdersRouter } from "./routers/addon-orders.router";
import { OrdersRouter } from "./routers/orders.router";
import { PaymentsRouter } from "./routers/payments.router";
import { SubscriptionsRouter } from "./routers/subscriptions.router";
import { CommercialRouter } from "./routers/commercial.router";
import { RiskRecordsRouter } from "./routers/risk-records.router";
import { ComplianceEventsRouter } from "./routers/compliance-events.router";
import { FeatureTogglesRouter } from "./routers/feature-toggles.router";
import { SystemParametersRouter } from "./routers/system-parameters.router";
import { NotificationLogsRouter } from "./routers/notification-logs.router";
import { SearchRouter } from "./routers/search.router";
@Module({
  imports: [
    VxConfigModule.register({
      domains: ["app", "auth", "database", "redis", "platform"],
    }),
    MailModule,
    AdminBffPoolsModule,
    OidcRpModule,
    // The commerce background jobs (provisioning dispatch, sharing/trial
    // expiry sweeps) moved to platform-api (product_310 D13) — admin-bff is
    // back to the operator governance face only.
  ],
  controllers: [
    HealthRouter,
    AuthRouter,
    MeRouter,
    CapabilitiesRouter,
    AtlasRouter,
    RunosRouter,
    AdminPermissionsRouter,
    AdminRolesRouter,
    AnnouncementsRouter,
    AuditLogsRouter,
    ApplicationsRouter,
    ProductsRouter,
    TicketsRouter,
    TenantsRouter,
    AccountsRouter,
    BillingRouter,
    InvoicesRouter,
    OrdersRouter,
    AddonOrdersRouter,
    PaymentsRouter,
    SubscriptionsRouter,
    CommercialRouter,
    RiskRecordsRouter,
    ComplianceEventsRouter,
    FeatureTogglesRouter,
    SystemParametersRouter,
    NotificationLogsRouter,
    SearchRouter,
    PlatformAdminsRouter,
    OperatorStepUpRouter,
  ],
  providers: [
    PlatformAuthService,
    OperatorExchangeService,
    SessionAggregator,
    OperatorStepUpService,
    OperatorAdminService,
    commerceServicesProvider,
    orderServiceProvider,
    promotionServiceProvider,
    addonServiceProvider,
    { provide: APP_GUARD, useClass: OperatorStepUpGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware, PermissionMiddleware)
      .forRoutes({ path: "api/*path", method: RequestMethod.ALL });
  }
}
