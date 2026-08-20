import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { Pool } from "pg";
import { PasswordHasher } from "../password/password-hasher";
import { MockUserRepository, PgUserRepository } from "../repository";
import { FavoritesService } from "../favorites/favorites.service";
import { AccountService } from "../service/account.service";
import { ACCOUNT_PG_POOL, USER_REPOSITORY } from "../tokens";

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
      useFactory: (
        config: VxConfigService,
        pgRepository: PgUserRepository,
        mockRepository: MockUserRepository,
      ) => {
        const database = config.database;
        const hasDatabaseConfig = Boolean(
          database.DATABASE_URL || database.DB_PASSWORD,
        );
        return hasDatabaseConfig ? pgRepository : mockRepository;
      },
    },
    PasswordHasher,
    AccountService,
    FavoritesService,
  ],
  exports: [AccountService, PasswordHasher, FavoritesService],
})
export class AccountModule {}
