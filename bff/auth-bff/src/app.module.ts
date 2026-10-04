/**
 * app.module.ts - Auth BFF Root Module (Identity Platform).
 * @package @vxture/bff-auth
 *
 * The legacy HS256 stack (AuthService + /auth/* routers + cross-domain) is retired.
 * Login/session/token run through AuthnModule + TokenModule (RS256 + new claims);
 * the OIDC protocol surface is OidcRouter/OidcService.
 */

import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { VxConfigModule } from "@vxture/core-config";
import { IamModule } from "@vxture/service-iam";
import { AccountModule } from "@vxture/service-account";
import { OrganizationModule } from "@vxture/service-organization";
import { SubscriptionModule } from "@vxture/service-subscription";
import { MailModule } from "@vxture/service-mail";
import { SmsModule } from "@vxture/service-sms";
import { AuthnModule } from "./authn/authn.module";
import { OauthModule } from "./oauth/oauth.module";
import { SocialAuthService } from "./oauth/social-auth.service";
import { SocialController } from "./oauth/social.controller";
import { AuthnController } from "./authn/authn.controller";
import { AccessTokenGuard } from "./authn/access-token.guard";
import { TenantLoginGuard } from "./authn/tenant-login-guard.service";
import { GovernanceController } from "./governance/governance.controller";
import { TokenModule } from "./token/token.module";
import { OidcService } from "./oidc/oidc.service";
import { AppScopeResolver } from "./oidc/app-scope.resolver";
import { TokenExchangeService } from "./oidc/token-exchange.service";
import { OperatorLoginGuard } from "./oidc/operator-login-guard.service";
import { OperatorMfaService } from "./oidc/operator-mfa.service";
import { OperatorWebauthnService } from "./oidc/operator-webauthn.service";
import { OperatorAnomalyService } from "./oidc/operator-anomaly.service";
import { OperatorSelfService } from "./oidc/operator-self.service";
import { OidcRouter } from "./routers/oidc.router";
import { OperatorWebauthnRouter } from "./routers/operator-webauthn.router";
import { OperatorSelfRouter } from "./routers/operator-self.router";
import { OperatorStepUpRouter } from "./routers/operator-stepup.router";
import { OperatorAdminInternalRouter } from "./routers/operator-admin-internal.router";
import { OperatorSessionsInternalRouter } from "./routers/operator-sessions-internal.router";
import { AccountAdminInternalRouter } from "./routers/account-admin-internal.router";
import { OperatorPublicRouter } from "./routers/operator-public.router";
import { InternalAuthGuard } from "./authn/internal-auth.guard";
import { ActorBindingGuard } from "./authn/actor-binding.guard";
import { AvatarController } from "./avatar/avatar.controller";
import { AvatarUploadController } from "./avatar/avatar-upload.controller";
import { RedisModule } from "./redis/redis.module";
import { HealthRouter } from "./routers/health.router";
import { customerNotificationsProvider } from "./notifications/customer-notifications.wiring";

@Module({
  imports: [
    VxConfigModule.register({
      domains: ["app", "auth", "database", "redis", "oauth", "platform"],
    }),
    JwtModule.register({}),
    RedisModule,
    IamModule,
    AccountModule,
    OrganizationModule,
    MailModule,
    SmsModule,
    AuthnModule,
    OauthModule,
    TokenModule,
    // Kept after the D13 platform-api split NOT for any /platform/* router
    // (those moved out) but because it provides COMMERCE_PG_POOL, which
    // AppScopeResolver and TokenExchangeService inject for OIDC claims.
    SubscriptionModule,
  ],
  controllers: [
    HealthRouter,
    AuthnController,
    GovernanceController,
    OidcRouter,
    OperatorWebauthnRouter,
    OperatorSelfRouter,
    OperatorStepUpRouter,
    OperatorAdminInternalRouter,
    OperatorSessionsInternalRouter,
    AccountAdminInternalRouter,
    OperatorPublicRouter,
    SocialController,
    AvatarController,
    AvatarUploadController,
  ],
  providers: [
    OidcService,
    AppScopeResolver,
    TokenExchangeService,
    SocialAuthService,
    OperatorLoginGuard,
    OperatorMfaService,
    OperatorWebauthnService,
    OperatorAnomalyService,
    OperatorSelfService,
    InternalAuthGuard,
    ActorBindingGuard,
    TenantLoginGuard,
    AccessTokenGuard,
    /*
     * 账号安全事件的通知开关（2026-09-29）。**必须列在这里**：`AccountService` 的通知器
     * 是 setter 注入的，未注入 = 一条都不发，而十四条里有七条只在本进程发生（邮件重置
     * 令牌改密、运营锁定 / 解锁 / 下线全部会话、没见过的设备登录）。删掉这一行，那七条
     * 静默消失而编译、守卫、boot-smoke 全绿——理由与验收条件都在 wiring 文件头里。
     */
    customerNotificationsProvider,
  ],
})
export class AppModule {}
