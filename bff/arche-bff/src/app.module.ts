import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { OperatorAuthzService } from "./auth/operator-authz.service";
import { OperatorStepUpService } from "./auth/operator-stepup.service";
import { OperatorStepUpGuard } from "./auth/step-up.guard";
import { OperatorAuthMiddleware } from "./middleware/operator-auth.middleware";
import { OperatorStepUpRouter } from "./routers/operator-stepup.router";
import { OidcRpModule } from "./oidc/oidc-rp.module";
import { ArcheBffPoolsModule } from "./providers/pools.module";
import { HealthRouter } from "./routers/health.router";
import { SessionRouter } from "./routers/session.router";
import { AuditLogsRouter } from "./routers/audit-logs.router";
import { NotificationLogsRouter } from "./routers/notification-logs.router";

/* 通用面:登录会话 / 健康 / step-up。治理业务 router 分批从 admin-bff 迁入:
 * PR②(Batch 1)审计日志 / 通知投递台账两条只读面已在此注册;账号 / 角色 /
 * 权限 / 风控 / 合规 / 配置等后续批次陆续迁入。 */
@Module({
  imports: [OidcRpModule, ArcheBffPoolsModule],
  controllers: [
    HealthRouter,
    SessionRouter,
    OperatorStepUpRouter,
    AuditLogsRouter,
    NotificationLogsRouter,
  ],
  providers: [
    OperatorAuthzService,
    OperatorAuthMiddleware,
    OperatorStepUpService,
    /* 全局守卫，但只在 @RequireStepUp() 标注的路由上真正生效——见守卫文件头
       关于"不走构造器注入"的那条 bootstrap 死锁坑。 */
    { provide: APP_GUARD, useClass: OperatorStepUpGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // 只挂 /api/*：`/auth/*` 是登录出入口（挂上去等于把自己锁在门外），
    // `/health` 要在无会话时也能答，给探针用。
    consumer.apply(OperatorAuthMiddleware).forRoutes("api/*");
  }
}
