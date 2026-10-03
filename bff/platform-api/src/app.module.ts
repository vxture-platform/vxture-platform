/**
 * app.module.ts - platform-api root module.
 * @package @vxture/bff-platform-api
 *
 * Product-facing S2S host (product_310 D13, split 2026-07-13):
 *  - C2 read face: PlatformEntitlementsRouter + PlatformSharingRouter
 *  - C3 write face: PlatformUsageRouter (consume/gauge)
 *  - 开通回执: PlatformProvisioningRouter (provisioning/ack) —— 产品 → 平台的
 *    反向信号，本期只记事实、不动 provisionings 的状态机
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
import { OpsTodosModule } from "@vxture/service-ops-todos";
import { ProvisioningModule } from "@vxture/service-provisioning";
import { SharingModule } from "@vxture/service-sharing";
import { SubscriptionModule } from "@vxture/service-subscription";
import { PlatformAuthGuard } from "./authn/platform-auth.guard";
import { S2sTokenVerifier } from "./authn/s2s-token-verifier.service";
import { AccountDeletionPurgeJob } from "./jobs/account-deletion-purge.job";
import { AddonLifecycleJob } from "./jobs/addon-lifecycle.job";
import { AnnouncementBroadcastJob } from "./jobs/announcement-broadcast.job";
import { InvitationExpiryJob } from "./jobs/invitation-expiry.job";
import { JobHealthAlertJob } from "./jobs/job-health-alert.job";
import { JobHeartbeatService } from "./jobs/job-heartbeat.service";
import { OpsTodoAlertJob } from "./jobs/ops-todo-alert.job";
import { OperatorSignalSweepJob } from "./jobs/operator-signal-sweep.job";
import { OrderPaymentExpiryJob } from "./jobs/order-payment-expiry.job";
import { ProvisioningDispatchJob } from "./jobs/provisioning-dispatch.job";
import { SharingExpiryJob } from "./jobs/sharing-expiry.job";
import { SubscriptionRenewalJob } from "./jobs/subscription-renewal.job";
import { TrialExpiryJob } from "./jobs/trial-expiry.job";
import { UsageRollupJob } from "./jobs/usage-rollup.job";
import { WsBasePoolJob } from "./jobs/ws-base-pool.job";
import { CustomerNotificationsWiring } from "./notifications/customer-notifications.wiring";
import { OperatorAlertsWiring } from "./notifications/operator-alerts.wiring";
import { IntegrationSignalService } from "./platform/integration-signal.service";
import { PlatformEntitlementsService } from "./platform/platform-entitlements.service";
import { PlatformProvisioningService } from "./platform/platform-provisioning.service";
import { PlatformUsageService } from "./platform/platform-usage.service";
import { TokenUsageService } from "./platform/token-usage.service";
import { HealthRouter } from "./routers/health.router";
import { PlatformEntitlementsRouter } from "./routers/platform-entitlements.router";
import { PlatformProvisioningRouter } from "./routers/platform-provisioning.router";
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
    // 2026-09-28 根治批：待办告警作业改读 @vxture/service-ops-todos（与 admin 待办页同一份算法）
    OpsTodosModule,
  ],
  controllers: [
    HealthRouter,
    PlatformEntitlementsRouter,
    PlatformUsageRouter,
    PlatformSharingRouter,
    PlatformProvisioningRouter,
  ],
  providers: [
    PlatformEntitlementsService,
    PlatformUsageService,
    // #547：原始 token 用量接收（同一个 /usage/consume 端点的 tokens 形态）
    TokenUsageService,
    PlatformProvisioningService,
    IntegrationSignalService,
    PlatformAuthGuard,
    S2sTokenVerifier,
    JobHeartbeatService,
    // P2-g：客户通知（站内 + 邮件）挂到 OrderService / SubscriptionService（setter 注入）
    CustomerNotificationsWiring,
    // #231：运营待办告警（只发邮件，4h 静默窗口）；自愈放弃经 setOpsAlerter 挂 OrderService
    OperatorAlertsWiring,
    OpsTodoAlertJob,
    // 2026-09-28 第二批：运营侧信号巡检（业务事件 11 类 + 审计白名单动作），
    // 产出 admin.operator_notices 的系统通告；去重键挡住回看窗口的重叠。
    OperatorSignalSweepJob,
    // #231 第二段：后台作业健康（失败 + 静默）——静默是真盲区，作业死了什么都不留
    JobHealthAlertJob,
    ProvisioningDispatchJob,
    SharingExpiryJob,
    TrialExpiryJob,
    // 2026-09-28 批 5：加油包生命周期客户通知（即将到期 / 已用尽 / 已过期）。
    // 三档都没有写入方可挂，只能巡检；去重靠客户收件箱的唯一键，每趟重扫同一批行。
    AddonLifecycleJob,
    // 2026-09-29：入组邀请到期。`expired` 此前全库零写入方（只在读侧按 expires_at
    // 派生），这一趟把状态写实并通知邀请人；存量闸门只闸通知，状态照扫。
    InvitationExpiryJob,
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
