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

/* PR① 脚手架:arche-bff 只保留登录会话 / 健康 / step-up 三条通用面。
 * 治理业务 router(账号 / 角色 / 权限 / 审计 / 合规 / 配置)于 PR② 从 admin-bff
 * 迁入并在此注册。 */
@Module({
  imports: [OidcRpModule, ArcheBffPoolsModule],
  controllers: [HealthRouter, SessionRouter, OperatorStepUpRouter],
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
