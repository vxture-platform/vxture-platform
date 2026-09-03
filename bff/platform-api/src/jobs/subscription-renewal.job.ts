/**
 * subscription-renewal.job.ts — 到期扫描 + 自动续费（product_330 P2-c）。
 *
 * 每 tick 两趟，顺序固定：
 *  1. 自动续费：到期前 SUBSCRIPTION_RENEW_LEAD_DAYS（默认 7）内、auto_renew 开的订阅开 renew 单；
 *     ¥0 即时结清履约（end_at 顺延），付费单等客户付款（TTL = 到期 + SUBSCRIPTION_RENEW_GRACE_DAYS，默认 3）。
 *  2. 到期扫描：end_at 已过、仍在用的非试用订阅 → expired（provisioning 钩子照常），付款后履约再复活。
 * 先续后扫，¥0 续上的行 end_at 已后移不会被扫到。
 *
 * 与 trial-expiry / order-payment-expiry 同一宿主模式：类定义时读一次 env、实例 inFlight 防重入、
 * 跨实例竞态由服务层 CAS / 行锁解决。SUBSCRIPTION_RENEWAL_SWEEP_INTERVAL_MS 调节频率（默认 60s）。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { sweepIntervalMs } from "./sweep-interval.util";

const envDays = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
};

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "subscription-renewal";

@Injectable()
export class SubscriptionRenewalJob {
  private readonly logger = new Logger(SubscriptionRenewalJob.name);
  private inFlight = false;
  private readonly intervalMs = sweepIntervalMs(
    process.env.SUBSCRIPTION_RENEWAL_SWEEP_INTERVAL_MS,
  );

  constructor(
    @Inject(OrderService)
    private readonly orders: OrderService,
    @Inject(SubscriptionService)
    private readonly subscriptions: SubscriptionService,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(sweepIntervalMs(process.env.SUBSCRIPTION_RENEWAL_SWEEP_INTERVAL_MS))
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const startedAt = Date.now();
    await this.heartbeat.recordStart(JOB_NAME, this.intervalMs);
    try {
      const renewal = await this.orders.runAutoRenewalPass({
        leadDays: envDays("SUBSCRIPTION_RENEW_LEAD_DAYS", 7),
        graceDays: envDays("SUBSCRIPTION_RENEW_GRACE_DAYS", 3),
      });
      if (renewal.created > 0 || renewal.skipped > 0) {
        this.logger.log(
          `auto-renew: ${renewal.created} order(s) created, ${renewal.fulfilled} ¥0 fulfilled, ${renewal.skipped} skipped (no price)`,
        );
      }
      const expired = await this.subscriptions.sweepExpiredSubscriptions();
      if (expired > 0) {
        this.logger.log(`expiry sweep: ${expired} subscription(s) → expired`);
      }
      await this.heartbeat.recordSuccess(
        JOB_NAME,
        Date.now() - startedAt,
        renewal.created + expired,
      );
    } catch (err) {
      // Never let a pass kill the interval; the next tick retries.
      this.logger.error(`subscription renewal pass failed: ${String(err)}`);
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
