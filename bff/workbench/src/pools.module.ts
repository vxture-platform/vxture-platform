/**
 * Read-only query pools and a column-restricted inbox acknowledgement pool.
 * @package @vxture/bff-workbench
 * @layer Application
 * @category module
 * @author AI-Generated
 * @date 2026-11-05
 */
import { Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";
import Redis from "ioredis";
import { loadConfig, type WorkbenchConfig } from "./config";
import {
  ACTIVITY_WRITE_POOL,
  CONFIG,
  INBOX_WRITE_POOL,
  PRIMARY_POOL,
  READ_POOL,
  REDIS,
} from "./tokens";

// ============================================================================
// Connection lifecycle
// ============================================================================
class Connections implements OnApplicationShutdown {
  constructor(
    @Inject(PRIMARY_POOL) private readonly primary: Pool,
    @Inject(READ_POOL) private readonly reporting: Pool,
    @Inject(INBOX_WRITE_POOL) private readonly inbox: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ACTIVITY_WRITE_POOL) private readonly activity: Pool | null,
  ) {}
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([
      this.primary.end(),
      this.reporting.end(),
      this.inbox.end(),
      this.activity?.end(),
    ]);
    this.redis.disconnect();
  }
}

@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig(process.env) },
    {
      provide: PRIMARY_POOL,
      inject: [CONFIG],
      useFactory: (config: WorkbenchConfig) =>
        new Pool({
          connectionString: config.databaseUrl,
          max: 5,
          connectionTimeoutMillis: 3000,
          statement_timeout: 5000,
          options: "-c default_transaction_read_only=on",
        }),
    },
    {
      provide: READ_POOL,
      inject: [CONFIG],
      useFactory: (config: WorkbenchConfig) =>
        new Pool({
          connectionString: config.reportingUrl,
          max: 5,
          connectionTimeoutMillis: 3000,
          statement_timeout: 5000,
          options: "-c default_transaction_read_only=on",
        }),
    },
    {
      provide: INBOX_WRITE_POOL,
      inject: [CONFIG],
      useFactory: (config: WorkbenchConfig) =>
        new Pool({
          connectionString: config.inboxDatabaseUrl,
          max: 2,
          connectionTimeoutMillis: 3000,
          statement_timeout: 5000,
          options: "-c default_transaction_read_only=off",
        }),
    },
    {
      provide: ACTIVITY_WRITE_POOL,
      inject: [CONFIG],
      useFactory: (config: WorkbenchConfig) =>
        config.activityDatabaseUrl
          ? new Pool({
              connectionString: config.activityDatabaseUrl,
              max: 2,
              connectionTimeoutMillis: 3000,
              statement_timeout: 5000,
              options: "-c default_transaction_read_only=off",
            })
          : null,
    },
    {
      provide: REDIS,
      inject: [CONFIG],
      useFactory: (config: WorkbenchConfig) =>
        new Redis(config.redisUrl, {
          lazyConnect: true,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 3000,
          commandTimeout: 5000,
          retryStrategy: (attempts) => Math.min(250 * attempts, 3000),
        }),
    },
    Connections,
  ],
  exports: [
    CONFIG,
    PRIMARY_POOL,
    READ_POOL,
    INBOX_WRITE_POOL,
    ACTIVITY_WRITE_POOL,
    REDIS,
  ],
})
export class PoolsModule {}
