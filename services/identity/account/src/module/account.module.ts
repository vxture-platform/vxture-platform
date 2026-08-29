import { Logger, Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { Pool } from "pg";
import { PasswordHasher } from "../password/password-hasher";
import { MockUserRepository, PgUserRepository } from "../repository";
import { FavoritesService } from "../favorites/favorites.service";
import { NotificationPreferencesService } from "../notification-preferences/notification-preferences.service";
import { AccountService } from "../service/account.service";
import { ACCOUNT_PG_POOL, USER_REPOSITORY } from "../tokens";

/**
 * 选出 USER_REPOSITORY 背后的实现。
 *
 * 生产环境 fail-closed（2026-08-30 审计）：MockUserRepository 内置一个仓库公开的
 * Argon2id 口令哈希（zhangsan / Zhangsan@2026）。它在 DATABASE_URL 与 DB_PASSWORD
 * 都为空时静默顶上——线上一次注入遗漏就等于开放一个人人皆知的账号，而且没有任何
 * 报错。所以生产环境缺库配置直接抛、拒绝启动；非生产保留今天的离线回退，但记一条
 * 警告，让「跑在假库上」在日志里可见。
 *
 * 判据用 NODE_ENV 而不是 config.isProduction：本模块只注册了 database 域，
 * VxConfigService 的 app 域在这里是空的，isProduction 恒为 false（见
 * core-config/config.service.ts:105）——拿它当门等于没有门。与 service-sms 的
 * fail-closed 判据保持一致。
 *
 * @throws {Error} 生产环境且 DATABASE_URL / DB_PASSWORD 均为空
 */
export function resolveUserRepository(
  config: Pick<VxConfigService, "database">,
  pgRepository: PgUserRepository,
  mockRepository: MockUserRepository,
): PgUserRepository | MockUserRepository {
  const database = config.database;
  const hasDatabaseConfig = Boolean(
    database.DATABASE_URL || database.DB_PASSWORD,
  );
  if (hasDatabaseConfig) return pgRepository;

  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "[AccountModule] 数据库未配置（DATABASE_URL 与 DB_PASSWORD 均为空），生产环境拒绝回退到 MockUserRepository",
    );
  }
  new Logger("AccountModule").warn(
    "数据库未配置（DATABASE_URL 与 DB_PASSWORD 均为空），使用内存 MockUserRepository —— 仅限非生产",
  );
  return mockRepository;
}

@Module({
  imports: [
    VxConfigModule.register({
      domains: ["database"],
    }),
  ],
  providers: [
    {
      provide: ACCOUNT_PG_POOL,
      inject: [VxConfigService],
      useFactory: (config: VxConfigService) => {
        const database = config.database;
        return new Pool(
          database.DATABASE_URL
            ? { connectionString: database.DATABASE_URL }
            : {
                host: database.DB_HOST,
                port: database.DB_PORT,
                database: database.DB_NAME,
                user: database.DB_USER,
                password: database.DB_PASSWORD,
                max: database.DB_POOL_MAX,
                ssl:
                  database.DB_SSL === "require"
                    ? { rejectUnauthorized: false }
                    : undefined,
              },
        );
      },
    },
    PgUserRepository,
    MockUserRepository,
    {
      provide: USER_REPOSITORY,
      inject: [VxConfigService, PgUserRepository, MockUserRepository],
      useFactory: resolveUserRepository,
    },
    PasswordHasher,
    AccountService,
    FavoritesService,
    NotificationPreferencesService,
  ],
  exports: [
    AccountService,
    PasswordHasher,
    FavoritesService,
    NotificationPreferencesService,
  ],
})
export class AccountModule {}
