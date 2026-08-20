/**
 * ws-base-pool.job.ts — interval driver for the workspace base storage pool
 * ensure (product_220 §4.4 target model, owner 2026-08-20 usage-quota line):
 * storage is a WORKSPACE resource, not a product entitlement — every live
 * workspace carries a `ws_base` storage.bytes pool granted by platform policy,
 * independent of any subscription.
 *
 * Sweep instead of a provisioning-time hook on purpose: the identity domain
 * (provisionOrg) never writes metering, and the same idempotent pass both
 * backfills existing workspaces and picks up new ones within a minute. The
 * write-side SQL (create-if-absent with retire-sticks semantics + reconcile
 * active pools to the configured default) lives in the commerce repository;
 * this class only drives it.
 *
 * WS_BASE_STORAGE_BYTES tunes the default grant (bytes; default 200 MiB =
 * 209715200, owner 2026-08-20 — policy-configurable, deliberately not
 * hard-coded). Read per tick so an env change lands without a redeploy-only
 * semantics surprise: the next pass reconciles every active base pool.
 * WS_BASE_POOL_SWEEP_INTERVAL_MS tunes the cadence (default 60s).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { SubscriptionService } from "@vxture/service-subscription";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { sweepIntervalMs } from "./sweep-interval.util";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "ws-base-pool";

/** 200 MiB — workspace default storage grant (owner 2026-08-20). */
const DEFAULT_BASE_BYTES = 209715200n;

/** Positive-integer env override, else the platform default. */
const baseStorageBytes = (): string => {
  const raw = process.env.WS_BASE_STORAGE_BYTES;
  if (raw && /^[1-9]\d{0,17}$/.test(raw)) return raw;
  return DEFAULT_BASE_BYTES.toString();
};

@Injectable()
export class WsBasePoolJob {
  private readonly logger = new Logger(WsBasePoolJob.name);
  private inFlight = false;
  private readonly intervalMs = sweepIntervalMs(
    process.env.WS_BASE_POOL_SWEEP_INTERVAL_MS,
  );

  constructor(
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(sweepIntervalMs(process.env.WS_BASE_POOL_SWEEP_INTERVAL_MS))
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const startedAt = Date.now();
    await this.heartbeat.recordStart(JOB_NAME, this.intervalMs);
    try {
      const { created, reconciled } =
        await this.subscriptions.ensureWorkspaceStorageBasePools(
          baseStorageBytes(),
        );
      if (created > 0 || reconciled > 0) {
        this.logger.log(
          `ws base pool sweep: ${created} created, ${reconciled} reconciled`,
        );
      }
      await this.heartbeat.recordSuccess(
        JOB_NAME,
        Date.now() - startedAt,
        created + reconciled,
      );
    } catch (err) {
      // Never let a pass kill the interval; the next tick retries.
      this.logger.error(`ws base pool sweep failed: ${String(err)}`);
      await this.heartbeat.recordFailure(
        JOB_NAME,
        Date.now() - startedAt,
        String(err),
      );
    } finally {
      this.inFlight = false;
    }
  }
}
