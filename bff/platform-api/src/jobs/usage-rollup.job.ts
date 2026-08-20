/**
 * usage-rollup.job.ts — interval driver for the usage_summary_* downsampling
 * rollup (data_commerce_200 §9: events → hours → days → weeks/months →
 * years). 纯统计/看板 — NEVER a billing basis: billing reads usage_events over
 * the subscription-anchored cycle window; these five tables only feed the
 * console usage-analytics views.
 *
 * The write logic (sliding-window recompute + idempotent upsert per layer)
 * lives in the commerce PgUsageRollupRepository; this class only drives it.
 * Cross-instance races are harmless by construction — both passes recompute
 * the same window to the same totals.
 *
 * USAGE_ROLLUP_INTERVAL_MS tunes the cadence (default 300s — boards tolerate
 * minutes of lag; the recompute window is hours wide, so missed ticks heal).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PgUsageRollupRepository } from "@vxture/service-subscription";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { sweepIntervalMs } from "./sweep-interval.util";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "usage-rollup";

const DEFAULT_INTERVAL_MS = 300_000;

const rollupIntervalMs = (): number => {
  const raw = process.env.USAGE_ROLLUP_INTERVAL_MS;
  if (raw === undefined || raw === "") return DEFAULT_INTERVAL_MS;
  return sweepIntervalMs(raw);
};

@Injectable()
export class UsageRollupJob {
  private readonly logger = new Logger(UsageRollupJob.name);
  private inFlight = false;
  private readonly intervalMs = rollupIntervalMs();

  constructor(
    @Inject(PgUsageRollupRepository)
    private readonly rollup: PgUsageRollupRepository,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(rollupIntervalMs())
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const startedAt = Date.now();
    await this.heartbeat.recordStart(JOB_NAME, this.intervalMs);
    try {
      const touched = await this.rollup.rollup();
      if (touched > 0) {
        this.logger.log(`usage rollup: ${touched} summary rows upserted`);
      }
      await this.heartbeat.recordSuccess(
        JOB_NAME,
        Date.now() - startedAt,
        touched,
      );
    } catch (err) {
      // Never let a pass kill the interval; the next tick retries.
      this.logger.error(`usage rollup failed: ${String(err)}`);
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
