import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { Pool } from "pg";
import { NOTICE_PG_POOL } from "../tokens";
import { PgNoticeRepository } from "../repository/pg-notice.repository";
import { NoticeService } from "../service/notice.service";

@Module({
  imports: [VxConfigModule.register({ domains: ["database"] })],
  providers: [
    {
      provide: NOTICE_PG_POOL,
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
    PgNoticeRepository,
    NoticeService,
  ],
  exports: [NoticeService],
})
export class NoticeModule {}
