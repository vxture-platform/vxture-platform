import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { Pool } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import { PgBillingRepository } from "../repository/pg-billing.repository";
import { PgReceiptRepository } from "../repository/pg-receipt.repository";
import { PgTenantClosureRepository } from "../repository/pg-tenant-closure.repository";
import { BillingService } from "../service/billing.service";
import { InvoiceReceiptService } from "../service/receipt.service";
import { TenantClosureReadService } from "../service/tenant-closure.service";

@Module({
  imports: [VxConfigModule.register({ domains: ["database"] })],
  providers: [
    {
      provide: COMMERCE_PG_POOL,
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
    PgBillingRepository,
    BillingService,
    PgReceiptRepository,
    InvoiceReceiptService,
    PgTenantClosureRepository,
    TenantClosureReadService,
  ],
  exports: [BillingService, InvoiceReceiptService, TenantClosureReadService],
})
export class BillingModule {}
