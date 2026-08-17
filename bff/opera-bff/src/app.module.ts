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
import { OperaBffPoolsModule } from "./providers/pools.module";
import { AtlasRouter } from "./routers/atlas.router";
import { AuditLogViewRouter } from "./routers/audit-log-view.router";
import { HealthRouter } from "./routers/health.router";
import { JobSchedulerRouter } from "./routers/job-scheduler.router";
import { MaintenanceWindowsRouter } from "./routers/maintenance-windows.router";
import { OidcClientRouter } from "./routers/oidc-client.router";
import { ProductCatalogRouter } from "./routers/product-catalog.router";
import { ProductHealthRouter } from "./routers/product-health.router";
import { RunosRouter } from "./routers/runos.router";
import { SessionRouter } from "./routers/session.router";
import { TenancyDirectoryRouter } from "./routers/tenancy-directory.router";

@Module({
  imports: [OidcRpModule, OperaBffPoolsModule],
  controllers: [
    HealthRouter,
    SessionRouter,
    MaintenanceWindowsRouter,
    ProductHealthRouter,
    JobSchedulerRouter,
    AtlasRouter,
    RunosRouter,
    ProductCatalogRouter,
    OidcClientRouter,
    AuditLogViewRouter,
    OperatorStepUpRouter,
    TenancyDirectoryRouter,
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
