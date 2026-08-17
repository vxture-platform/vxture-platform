/**
 * order-payment-expiry.job.ts — interval driver for the two payment-order
 * passes (product_321 §4.3):
 *
 *  1. Timeout sweep: close pending offline orders past the payment TTL. The
 *     predicate carries the full P4 guard (no declared pending_verify leg,
 *     zero collected money) — an order with ANY real income is never
 *     auto-closed.
 *  2. Hung-order reconcile (P8 self-heal): finish stage-2 activation for
 *     invoice-cleared orders whose activation never landed (instant voucher
 *     settlement crash window / legacy ledger-bypass strays). Per-order
 *     failure ledger inside the service stops auto-retry at the limit.
 *
 * Same host pattern as the trial expiry sweep: env read once at class
 * definition, in-flight guard against same-instance pile-up, cross-instance
 * races resolved by write-side row locks/CAS in the service.
 *
 * ORDER_PAYMENT_SWEEP_INTERVAL_MS tunes the cadence (default 60s);
 * ORDER_PAYMENT_TTL_MINUTES tunes the payment window (default 30).
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { SubscriptionService } from "@vxture/service-subscription";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { sweepIntervalMs } from "./sweep-interval.util";

const ttlMinutes = (): number => {
  const raw = Number(process.env.ORDER_PAYMENT_TTL_MINUTES);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 30;
};

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "order-payment-expiry";

@Injectable()
export class OrderPaymentExpiryJob {
  private readonly logger = new Logger(OrderPaymentExpiryJob.name);
  private inFlight = false;
  private readonly intervalMs = sweepIntervalMs(
    process.env.ORDER_PAYMENT_SWEEP_INTERVAL_MS,
  );

  constructor(
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(sweepIntervalMs(process.env.ORDER_PAYMENT_SWEEP_INTERVAL_MS))
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const startedAt = Date.now();
    await this.heartbeat.recordStart(JOB_NAME, this.intervalMs);
    try {
      const closed =
        await this.subscriptions.sweepExpiredPaymentOrders(ttlMinutes());
      if (closed > 0) {
        this.logger.log(`payment expiry sweep: ${closed} order(s) closed`);
      }
      const healed = await this.subscriptions.reconcileHungPaidOrders();
      if (healed > 0) {
        this.logger.log(`payment reconcile: ${healed} hung order(s) activated`);
      }
      await this.heartbeat.recordSuccess(
        JOB_NAME,
        Date.now() - startedAt,
        closed + healed,
      );
    } catch (err) {
      // Never let a pass kill the interval; the next tick retries.
      this.logger.error(`payment order sweep failed: ${String(err)}`);
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
