/**
 * sharing-expiry.job.ts — interval driver for the sharing grant expiry sweep
 * (product_310 P4.3; semantics = data_sharing_200 §4: expires_at is a passive
 * axis with no write event, so a minute-level sweep emits grant.invalidated
 * for grants that lapsed).
 *
 * admin-bff hosts it next to the provisioning dispatcher (same queue, same
 * host). Deterministic idempotency keys make overlapping instances safe; the
 * in-flight guard only prevents same-instance pile-up.
 *
 * SHARING_EXPIRY_SWEEP_INTERVAL_MS tunes the cadence (default 60s; read once
 * at class definition, matching the dispatcher's env-read pattern).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { SharingService } from "@vxture/service-sharing";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { sweepIntervalMs } from "./sweep-interval.util";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "sharing-expiry";

@Injectable()
export class SharingExpiryJob {
  private readonly logger = new Logger(SharingExpiryJob.name);
  private inFlight = false;
  private readonly intervalMs = sweepIntervalMs(
    process.env.SHARING_EXPIRY_SWEEP_INTERVAL_MS,
  );

  constructor(
    @Inject(SharingService)
    private readonly sharing: SharingService,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(sweepIntervalMs(process.env.SHARING_EXPIRY_SWEEP_INTERVAL_MS))
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const startedAt = Date.now();
    await this.heartbeat.recordStart(JOB_NAME, this.intervalMs);
    try {
      const emitted = await this.sharing.sweepExpired();
      if (emitted > 0) {
        this.logger.log(`expiry sweep: ${emitted} grant.invalidated emitted`);
      }
      await this.heartbeat.recordSuccess(
        JOB_NAME,
        Date.now() - startedAt,
        emitted,
      );
    } catch (err) {
      // Never let a pass kill the interval; the next tick retries.
      this.logger.error(`expiry sweep failed: ${String(err)}`);
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
