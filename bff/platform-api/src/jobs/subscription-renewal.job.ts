/**
 * subscription-renewal.job.ts — 到期扫描 + 自动续费（product_330 P2-c）。
 *
 * 每 tick 六趟，顺序固定：
 *  1. 自动续费：到期前 SUBSCRIPTION_RENEW_LEAD_DAYS（默认 3，owner 2026-09-03：到期前 3 天即可）内、auto_renew 开的订阅开 renew 单；
 *     ¥0 即时结清履约（end_at 顺延），付费单等客户付款（TTL = 到期 + SUBSCRIPTION_RENEW_GRACE_DAYS，默认 3）。
 *  2. 入宽限（2026-09-25，S8）：end_at 已过但还在宽限里、续费单在途未付的行 → overdue。权益不变，
 *     只是把「服务还在、钱没到」这件事说清楚并通知客户。此前这一档全仓零写入方，到期即停服。
 *  3. 到期扫描：end_at 已过、不在宽限里的非试用订阅 → expired（provisioning 钩子照常），付款后履约再复活。
 *     冻结（suspended）的行 2026-09-25 起也进这一趟——此前它们永不到期、永不释放。
 *  4. 到期前提醒 + 写 expiring（S6）。
 *  5. 暂停到点处置（2026-09-25 步骤三）：暂停超过 subscription.max_suspend_days 还没恢复的，
 *     平台原因强制恢复、客户违规终止——顺延让有效到期日一直往后走，没有上限那条订阅永不到期。
 *  6. 顺延结算兜底：已闭合但没结算的 episode 结成天数加到 end_at。运营恢复时 admin-bff 会
 *     立刻结算一次，这一趟只捞那次失败/漏掉的（判据是 granted_seconds is null，幂等）。
 * 先续后扫，¥0 续上的行 end_at 已后移不会被扫到；入宽限必须在到期扫描之前。
 * 到点处置放在到期扫描**之后**：先让该到期的走完，剩下的才是真正「停太久」的。
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

  /**
   * 四趟，顺序 load-bearing；返回本 tick 处理的条目数（心跳 items）。
   *
   * **宽限天数一处取值传三处**（续费单 TTL / 入宽限 / 到期收口）。分头各读一次 env 迟早
   * 会有一处漏改，症状是「续费单还能付，服务已经终止」——客户付了钱没服务。
   *
   * 顺序：续费 → 入宽限 → 到期扫描 → 到期前提醒。把到期扫描提到入宽限之前，它会在
   * end_at 当天就把行扫成 expired，`overdue` 这一档永远不会出现。
   */
  private async pass(): Promise<number> {
    const leadDays = envDays("SUBSCRIPTION_RENEW_LEAD_DAYS", 3);
    const graceDays = envDays("SUBSCRIPTION_RENEW_GRACE_DAYS", 3);

    const renewal = await this.orders.runAutoRenewalPass({
      leadDays,
      graceDays,
    });
    if (renewal.created > 0 || renewal.skipped > 0) {
      this.logger.log(
        `auto-renew: ${renewal.created} order(s) created, ${renewal.fulfilled} ¥0 fulfilled, ${renewal.skipped} skipped (no price)`,
      );
    }
    // 2. 入宽限（S8）：自动续费的单到期没付上，服务先留着，状态说清楚并通知客户。
    const overdue = await this.subscriptions.markOverdue(graceDays);
    if (overdue > 0) {
      this.logger.log(`grace window: ${overdue} subscription(s) → overdue`);
    }
    const expired = await this.subscriptions.sweepExpiredSubscriptions(
      100,
      graceDays,
    );
    if (expired > 0) {
      this.logger.log(`expiry sweep: ${expired} subscription(s) → expired`);
    }
    // 4. 到期前提醒（P2-g）：自动续费关着、leadDays 内到期的订阅——站内 + 邮件，按订阅 ×
    //    到期日去重；同一趟里把状态也写成 expiring（S6，此前只发信不写状态）。
    const soon = await this.subscriptions.notifyExpiringSoon(leadDays);
    if (soon.notified > 0 || soon.marked > 0) {
      this.logger.log(
        `expiry reminders: ${soon.notified} notified, ${soon.marked} → expiring`,
      );
    }
    // 5. 暂停到点处置（步骤三）：天数在 admin.settings 里，服务层自己读。
    const deadline = await this.subscriptions.sweepOverdueSuspensions();
    if (deadline.resumed > 0 || deadline.terminated > 0) {
      this.logger.log(
        `suspension deadline: ${deadline.resumed} force-resumed, ${deadline.terminated} terminated`,
      );
    }
    // 6. 顺延结算兜底：正常路径上 admin-bff 恢复后就结算了，这一趟捞漏掉的那些。
    const settled = await this.subscriptions.settleSuspensionExtension();
    if (settled > 0) {
      this.logger.log(`suspension settle: ${settled} episode(s) settled`);
    }
    return (
      renewal.created +
      overdue +
      expired +
      soon.notified +
      deadline.resumed +
      deadline.terminated +
      settled
    );
  }
}
