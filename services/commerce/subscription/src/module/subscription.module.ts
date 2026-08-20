import { Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { ProvisioningModule } from "@vxture/service-provisioning";
import { PromotionModule } from "@vxture/service-promotion";
import { Pool } from "pg";
import { COMMERCE_PG_POOL } from "../tokens";
import { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import { SubscriptionService } from "../service/subscription.service";
import { PgConsumeRepository } from "../repository/pg-consume.repository";
import { PgUsageRollupRepository } from "../repository/pg-usage-rollup.repository";
import { ConsumeService } from "../service/consume.service";

@Module({
  // ProvisioningModule: the subscription lifecycle is the provisioning-enqueue
  // caller (product_310 P2.3b) — activation/lapse fan out per-component
  // tenant.provisioned / tenant.deprovisioned events.
  // PromotionModule: the declare/sweep orchestration reserves & releases
  // vouchers inside the order transaction (product_321 §5.1). It provides its
  // own (non-exported) pool under the same token string — no DI collision.
  imports: [
    VxConfigModule.register({ domains: ["database"] }),
    ProvisioningModule,
    PromotionModule,
  ],
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
    PgSubscriptionRepository,
    SubscriptionService,
    PgConsumeRepository,
    ConsumeService,
    PgUsageRollupRepository,
  ],
  exports: [
    COMMERCE_PG_POOL,
    SubscriptionService,
    ConsumeService,
    PgUsageRollupRepository,
  ],
})
export class SubscriptionModule {}
