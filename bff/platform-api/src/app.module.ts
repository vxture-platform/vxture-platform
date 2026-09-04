/**
 * app.module.ts - platform-api root module.
 * @package @vxture/bff-platform-api
 *
 * Product-facing S2S host (product_310 D13, split 2026-07-13):
 *  - C2 read face: PlatformEntitlementsRouter + PlatformSharingRouter
 *  - C3 write face: PlatformUsageRouter (consume/gauge)
 *  - commerce jobs: provisioning dispatch + sharing/trial expiry sweeps
 *    (moved from admin-bff; the engine modules are self-contained, each
 *    with its own pool from the database config domain)
 *
 * auth-bff keeps identity only (OIDC/authn/operator); admin-bff keeps the
 * operator governance face. SubscriptionModule here also provides the
 * COMMERCE_PG_POOL the entitlement/usage services inject.
 */

import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { VxConfigModule } from "@vxture/core-config";
import { AccountModule } from "@vxture/service-account";
import { OrganizationModule } from "@vxture/service-organization";
import { ProvisioningModule } from "@vxture/service-provisioning";
import { SharingModule } from "@vxture/service-sharing";
import { SubscriptionModule } from "@vxture/service-subscription";
import { PlatformAuthGuard } from "./authn/platform-auth.guard";
import { S2sTokenVerifier } from "./authn/s2s-token-verifier.service";
import { AccountDeletionPurgeJob } from "./jobs/account-deletion-purge.job";
import { AnnouncementBroadcastJob } from "./jobs/announcement-broadcast.job";
import { JobHeartbeatService } from "./jobs/job-heartbeat.service";
import { OrderPaymentExpiryJob } from "./jobs/order-payment-expiry.job";
import { ProvisioningDispatchJob } from "./jobs/provisioning-dispatch.job";
import { SharingExpiryJob } from "./jobs/sharing-expiry.job";
import { SubscriptionRenewalJob } from "./jobs/subscription-renewal.job";
import { TrialExpiryJob } from "./jobs/trial-expiry.job";
import { UsageRollupJob } from "./jobs/usage-rollup.job";
import { WsBasePoolJob } from "./jobs/ws-base-pool.job";
import { CustomerNotificationsWiring } from "./notifications/customer-notifications.wiring";
import { IntegrationSignalService } from "./platform/integration-signal.service";
import { PlatformEntitlementsService } from "./platform/platform-entitlements.service";
import { PlatformUsageService } from "./platform/platform-usage.service";
import { HealthRouter } from "./routers/health.router";
import { PlatformEntitlementsRouter } from "./routers/platform-entitlements.router";
import { PlatformSharingRouter } from "./routers/platform-sharing.router";
import { PlatformUsageRouter } from "./routers/platform-usage.router";

@Module({
  imports: [
    VxConfigModule.register({
      domains: ["app", "auth", "database", "redis", "platform"],
    }),
    ScheduleModule.forRoot(),
    SubscriptionModule,
    SharingModule,
    ProvisioningModule,
    // 批 5b:删除账号 30 天保留期清扫(AccountDeletionPurgeJob)要账号与租户两个服务
    AccountModule,
    OrganizationModule,
  ],
  controllers: [
    HealthRouter,
    PlatformEntitlementsRouter,
    PlatformUsageRouter,
    PlatformSharingRouter,
  ],
  providers: [
    PlatformEntitlementsService,
    PlatformUsageService,
    IntegrationSignalService,
    PlatformAuthGuard,
    S2sTokenVerifier,
    JobHeartbeatService,
    // P2-g：客户通知（站内 + 邮件）挂到 OrderService / SubscriptionService（setter 注入）
    CustomerNotificationsWiring,
    ProvisioningDispatchJob,
    SharingExpiryJob,
    TrialExpiryJob,
    OrderPaymentExpiryJob,
    SubscriptionRenewalJob,
    // P2-h：公告推送（站内 + 按偏好邮件），publish_at 到点即播
    AnnouncementBroadcastJob,
    WsBasePoolJob,
    UsageRollupJob,
    // 批 5b:自助删除账号 30 天保留期到期清扫
    AccountDeletionPurgeJob,
  ],
})
export class AppModule {}
