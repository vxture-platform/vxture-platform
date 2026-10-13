/**
 * Read-only pool for product reconciliation queries.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category provider
 * @author AI-Generated
 * @date 2026-10-12
 */
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { VxConfigService } from "@vxture/core-config";
import { Pool } from "pg";

/** Separate from commerce's write pool, including on a primary fallback. */
export const PROVISIONING_READ_POOL = Symbol("PROVISIONING_READ_POOL");

/** Build a read-only session pool from the database config domain. */
export const provisioningReadPoolProvider = {
  provide: PROVISIONING_READ_POOL,
  inject: [VxConfigService],
  useFactory: (config: VxConfigService): Pool => {
    const db = config.database;
    const connectionString = db.REPORTING_RO_DATABASE_URL ?? db.DATABASE_URL;
    return new Pool({
      ...(connectionString
        ? { connectionString }
        : {
            host: db.DB_HOST,
            port: db.DB_PORT,
            database: db.DB_NAME,
            user: db.DB_USER,
            password: db.DB_PASSWORD,
            ssl:
              db.DB_SSL === "require"
                ? { rejectUnauthorized: false }
                : undefined,
          }),
      max: db.DB_POOL_MAX,
      options: "-c default_transaction_read_only=on",
    });
  },
};

/** Release this host's read pool when Nest shuts down. */
@Injectable()
export class ProvisioningReadPoolLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PROVISIONING_READ_POOL) private readonly pool: Pool) {}

  /** Drain connections after requests have finished. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
