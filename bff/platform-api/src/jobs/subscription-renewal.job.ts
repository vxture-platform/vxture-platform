/**
 * subscription-renewal.job.ts — 到期扫描 + 自动续费（product_330 P2-c）。
 *
 * 每 tick 两趟，顺序固定：
 *  1. 自动续费：到期前 SUBSCRIPTION_RENEW_LEAD_DAYS（默认 3，owner 2026-09-03：到期前 3 天即可）内、auto_renew 开的订阅开 renew 单；
 *     ¥0 即时结清履约（end_at 顺延），付费单等客户付款（TTL = 到期 + SUBSCRIPTION_RENEW_GRACE_DAYS，默认 3）。
 *  2. 到期扫描：end_at 已过、仍在用的非试用订阅 → expired（provisioning 钩子照常），付款后履约再复活。
 * 先续后扫，¥0 续上的行 end_at 已后移不会被扫到。
 *
 * 宿主模式同其它 sweep 作业（runHeartbeatTick：心跳 + 失败不杀 interval）；实例 inFlight 防重入，
 * 跨实例竞态由服务层 CAS / 行锁解决。SUBSCRIPTION_RENEWAL_SWEEP_INTERVAL_MS 调节频率（默认 60s）。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import { JobHeartbeatService } from "./job-heartbeat.service";
import {
  envDays,
  runHeartbeatTick,
  sweepIntervalMs,
} from "./sweep-interval.util";

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
    try {
      await runHeartbeatTick(
        {
          heartbeat: this.heartbeat,
          jobName: JOB_NAME,
          intervalMs: this.intervalMs,
          logger: this.logger,
          label: "subscription renewal pass",
        },
        () => this.pass(),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /** 先续后扫；返回本 tick 处理的条目数（心跳 items）。 */
  private async pass(): Promise<number> {
    const renewal = await this.orders.runAutoRenewalPass({
      leadDays: envDays("SUBSCRIPTION_RENEW_LEAD_DAYS", 3),
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
    // 3. 到期前提醒（P2-g）：自动续费关着、leadDays 内到期的订阅——站内 + 邮件，按订阅 × 到期日去重。
    const reminded = await this.subscriptions.notifyExpiringSoon(
      envDays("SUBSCRIPTION_RENEW_LEAD_DAYS", 3),
    );
    if (reminded > 0) {
      this.logger.log(`expiry reminders: ${reminded} subscription(s) notified`);
    }
    return renewal.created + expired + reminded;
  }
}
