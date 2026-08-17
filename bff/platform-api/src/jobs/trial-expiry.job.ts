/**
 * trial-expiry.job.ts — interval driver for the trial expiry sweep
 * (product_310 D10; semantics = data_commerce_200 §1: trial_end_at is a
 * passive axis with no write event, so a minute-level sweep transitions
 * lapsed never-paid trials trialing → expired through SubscriptionService,
 * which fires the existing deprovision + subscription_changed wiring).
 *
 * admin-bff hosts it next to the provisioning dispatcher and the sharing
 * expiry sweep (same host, same queue downstream). Cross-instance/cross-pass
 * races (two sweeps, or a sweep racing an admin renew) are resolved by the
 * write-side compare-and-set in sweepLapsedTrials (expectedStatus='trialing')
 * — a losing pass no-ops rather than clobbering the winner. The in-flight
 * guard here only prevents same-instance tick pile-up.
 *
 * TRIAL_EXPIRY_SWEEP_INTERVAL_MS tunes the cadence (default 60s; read once
 * at class definition, matching the dispatcher's env-read pattern).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { SubscriptionService } from "@vxture/service-subscription";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { sweepIntervalMs } from "./sweep-interval.util";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "trial-expiry";

@Injectable()
export class TrialExpiryJob {
  private readonly logger = new Logger(TrialExpiryJob.name);
  private inFlight = false;
  private readonly intervalMs = sweepIntervalMs(
    process.env.TRIAL_EXPIRY_SWEEP_INTERVAL_MS,
  );

  constructor(
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(sweepIntervalMs(process.env.TRIAL_EXPIRY_SWEEP_INTERVAL_MS))
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const startedAt = Date.now();
    await this.heartbeat.recordStart(JOB_NAME, this.intervalMs);
    try {
      const transitioned = await this.subscriptions.sweepLapsedTrials();
      if (transitioned > 0) {
        this.logger.log(
          `trial expiry sweep: ${transitioned} trialing → expired`,
        );
      }
      await this.heartbeat.recordSuccess(
        JOB_NAME,
        Date.now() - startedAt,
        transitioned,
      );
    } catch (err) {
      // Never let a pass kill the interval; the next tick retries.
      this.logger.error(`trial expiry sweep failed: ${String(err)}`);
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
