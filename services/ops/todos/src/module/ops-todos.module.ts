import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { Pool } from "pg";
import { OPS_TODOS_PG_POOL } from "../tokens";
import { OpsTodoRepository } from "../repository/pg-ops-todo.repository";

/**
 * 与 service-notice 的 NoticeModule 同一装法：自带连接池（database 域配置），
 * 只导出仓储——两个 BFF 各自 import 本模块、`@Inject(OpsTodoRepository)` 即可。
 */
@Module({
  imports: [VxConfigModule.register({ domains: ["database"] })],
  providers: [
    {
      provide: OPS_TODOS_PG_POOL,
      inject: [VxConfigService],
      useFactory: (config: VxConfigService) => {
        const db = config.database;
        return new Pool(
          db.DATABASE_URL
            ? { connectionString: db.DATABASE_URL }
            : {
                host: db.DB_HOST,
                port: db.DB_PORT,
                database: db.DB_NAME,
                user: db.DB_USER,
                password: db.DB_PASSWORD,
                max: db.DB_POOL_MAX,
                ssl:
                  db.DB_SSL === "require"
                    ? { rejectUnauthorized: false }
                    : undefined,
              },
        );
      },
    },
    OpsTodoRepository,
  ],
  exports: [OpsTodoRepository],
})
export class OpsTodosModule {}
