/**
 * pools.module.ts — opera-bff 的 pg 连接池。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 与 admin-bff 的 pools.module 同形：同一套 VxConfigService.database 取值顺序
 * （显式 connectionString → DATABASE_URL → 离散字段），RO 可单独指向只读副本。
 *
 * ⚠ 这份与 admin-bff 那份目前是**两处同样的代码**，是有意的：现在只有一个真实
 *   消费方时抽公共包属于投机。等 opera-bff 的数据面长齐、两边都在用，再按两个
 *   真实消费方的共性抽包——那时候抽出来的边界才有依据。
 */
import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { Pool } from "pg";
import { ARCHE_BFF_RO_POOL, ARCHE_BFF_RW_POOL } from "../tokens";

function makePool(
  connectionString: string | undefined,
  config: VxConfigService["database"],
): Pool {
  if (connectionString) {
    return new Pool({ connectionString });
  }
  if (config.DATABASE_URL) {
    return new Pool({ connectionString: config.DATABASE_URL });
  }
  return new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    max: config.DB_POOL_MAX,
    ssl:
      config.DB_SSL === "require" ? { rejectUnauthorized: false } : undefined,
  });
}

@Module({
  imports: [VxConfigModule.register({ domains: ["database"] })],
  providers: [
    {
      provide: ARCHE_BFF_RW_POOL,
      inject: [VxConfigService],
      useFactory: (config: VxConfigService) =>
        makePool(undefined, config.database),
    },
    {
      provide: ARCHE_BFF_RO_POOL,
      inject: [VxConfigService],
      useFactory: (config: VxConfigService) =>
        makePool(config.database.REPORTING_RO_DATABASE_URL, config.database),
    },
  ],
  exports: [ARCHE_BFF_RO_POOL, ARCHE_BFF_RW_POOL],
})
export class ArcheBffPoolsModule {}
