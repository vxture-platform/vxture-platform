/**
 * provisioning.module.ts - wiring for the provisioning dispatcher (P4)
 * @package @vxture/service-provisioning
 *
 * Provides the PG pool, repository, service, and default secret-resolver /
 * alert-sink / dispatch-config. Hosts (admin-bff) import this module and drive
 * dispatchPending() on an interval; they may override WEBHOOK_SECRET_RESOLVER /
 * PROVISIONING_ALERT_SINK with secret-manager / ops-backed implementations.
 */
import { Logger, Module } from "@nestjs/common";
import { VxConfigModule, VxConfigService } from "@vxture/core-config";
import { Pool } from "pg";
import { PgProvisioningRepository } from "../repository/pg-provisioning.repository";
import {
  PROVISIONING_DISPATCH_CONFIG,
  ProvisioningService,
} from "../service/provisioning.service";
import {
  PROVISIONING_ALERT_SINK,
  PROVISIONING_PG_POOL,
  WEBHOOK_SECRET_RESOLVER,
} from "../tokens";
import type {
  DispatchConfig,
  ProvisioningAlertSink,
  WebhookSecretResolver,
} from "../types/provisioning.types";

const num = (v: string | undefined, d: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

@Module({
  imports: [VxConfigModule.register({ domains: ["database"] })],
  providers: [
    {
      provide: PROVISIONING_PG_POOL,
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
    {
      provide: PROVISIONING_DISPATCH_CONFIG,
      useFactory: (): DispatchConfig => ({
        maxAttempts: num(process.env.PROVISION_MAX_ATTEMPTS, 10),
        backoffBaseSec: num(process.env.PROVISION_BACKOFF_BASE, 30),
        backoffCapSec: num(process.env.PROVISION_BACKOFF_CAP, 3600),
        leaseSeconds: num(process.env.PROVISION_LEASE_SECONDS, 30),
        batchSize: num(process.env.PROVISION_BATCH, 20),
        timeoutMs: num(process.env.PROVISION_TIMEOUT_MS, 10000),
      }),
    },
    {
      // Default: webhook_secret_ref is an env var name (dev). Prod hosts override
      // this with a secret-manager-backed resolver.
      provide: WEBHOOK_SECRET_RESOLVER,
      useFactory: (): WebhookSecretResolver => ({
        resolve: (ref) => process.env[ref] ?? null,
      }),
    },
    {
      // Default: log exhaustion. Hosts may override to write admin.governance.
      provide: PROVISIONING_ALERT_SINK,
      useFactory: (): ProvisioningAlertSink => {
        const logger = new Logger("ProvisioningAlert");
        return {
          deliveryFailed: (i) =>
            logger.error(
              `webhook delivery FAILED id=${i.deliveryId} tenant=${i.tenantId} ` +
                `app=${i.appCode} event=${i.eventType} attempts=${i.attempts} ` +
                `lastCode=${i.lastResponseCode ?? "n/a"}`,
            ),
        };
      },
    },
    PgProvisioningRepository,
    ProvisioningService,
  ],
  // PROVISIONING_PG_POOL 额外导出：platform-api 的 JobHeartbeatService（后台任务
  // 心跳，provisioning.background_jobs）复用同一个池，不为一张心跳表另开一条连接。
  exports: [ProvisioningService, PROVISIONING_PG_POOL],
})
export class ProvisioningModule {}
