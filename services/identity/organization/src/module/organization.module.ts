import { Logger, Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { chooseDevFallback } from "@vxture/core-utils";
import { Pool } from "pg";
import {
  MockOrganizationRepository,
  PgOrganizationRepository,
} from "../repository";
import { ActiveContextService } from "../service/active-context.service";
import { GovernanceService } from "../service/governance.service";
import { OrganizationService } from "../service/organization.service";
import { ORGANIZATION_REPOSITORY, ORG_PG_POOL } from "../tokens";

/**
 * 选出 ORGANIZATION_REPOSITORY 背后的实现。
 *
 * 生产环境 fail-closed（2026-08-30 审计）：MockOrganizationRepository 是一份进程内
 * 假数据，在 DATABASE_URL 与 DB_PASSWORD 都为空时静默顶上——线上一次注入遗漏，
 * 组织 / 工作区 / 成员关系就全部跑在假数据上，且没有任何报错。所以生产环境缺库
 * 配置直接抛、拒绝启动；非生产保留今天的离线回退，但记一条警告。
 *
 * 规则在 core-utils `chooseDevFallback`（判据 NODE_ENV，同 service-account 的
 * resolveUserRepository 那条注释）；这里只提供接线。
 *
 * @throws {Error} 生产环境且 DATABASE_URL / DB_PASSWORD 均为空
 */
export function resolveOrganizationRepository(
  config: Pick<VxConfigService, "database">,
  pgRepository: PgOrganizationRepository,
  mockRepository: MockOrganizationRepository,
): PgOrganizationRepository | MockOrganizationRepository {
  const { DATABASE_URL, DB_PASSWORD } = config.database;
  return chooseDevFallback<
    PgOrganizationRepository | MockOrganizationRepository
  >({
    scope: "OrganizationModule",
    configured: Boolean(DATABASE_URL || DB_PASSWORD),
    real: pgRepository,
    fallback: mockRepository,
    fallbackName: "内存 MockOrganizationRepository",
    missing: "数据库未配置（DATABASE_URL 与 DB_PASSWORD 均为空）",
    warn: (message) => new Logger("OrganizationModule").warn(message),
  });
}

@Module({
  imports: [
    VxConfigModule.register({
      domains: ["database"],
    }),
  ],
  providers: [
    {
      provide: ORG_PG_POOL,
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
    PgOrganizationRepository,
    MockOrganizationRepository,
    {
      provide: ORGANIZATION_REPOSITORY,
      inject: [
        VxConfigService,
        PgOrganizationRepository,
        MockOrganizationRepository,
      ],
      useFactory: resolveOrganizationRepository,
    },
    OrganizationService,
    GovernanceService,
    ActiveContextService,
  ],
  exports: [OrganizationService, GovernanceService, ActiveContextService],
})
export class OrganizationModule {}
