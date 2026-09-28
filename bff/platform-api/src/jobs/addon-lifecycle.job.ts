/**
 * addon-lifecycle.job.ts — 加油包生命周期客户通知的 interval 驱动（2026-09-28 批 5）。
 *
 * 为什么是作业而不是写入方的一条尾巴：加油包池上「快到期了」「量用光了」「过期了」
 * 三件事都没有任何一次写操作可以搭——它们是时间与水位的自然后果。同形的先例是订阅的
 * 「即将到期」（SubscriptionRenewalJob 第 4 趟）：每趟重扫同一批行，去重只靠客户收件箱的
 * 唯一键（account_id, template_code, reference_type, reference_id）。
 *
 * 全仓的定时作业只住这一个目录，所以这里是唯一落点。作业名进
 * provisioning.background_jobs 是**首趟 tick 自动登记**的（JobHeartbeatService.recordStart
 * 自带 on conflict (job_name) do update），运维台「任务调度」随即可见——不需要手工建库行、
 * 不需要 seed。
 *
 * 环境变量（默认内建，只在调优时覆盖）：
 *   ADDON_LIFECYCLE_SWEEP_INTERVAL_MS  节奏（默认 60s，下限 5s，与其它 sweep 同一夹取）
 *   ADDON_LIFECYCLE_LEAD_DAYS          到期前多少天提醒（默认 7）
 *   ADDON_LIFECYCLE_BACKLOG_DAYS       终态回看几天（默认 3）——**存量闸门**：
 *     首趟不许把历史上所有已过期 / 已用尽的包一次性播出去（订阅到期扫描踩过这个坑）。
 *
 * inFlight 只防同实例 tick 叠加；跨实例 / 跨趟的重复由那个唯一键兜住，多跑一趟不会多发。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { AddonService } from "@vxture/service-subscription";
import { JobHeartbeatService } from "./job-heartbeat.service";
import {
  envDays,
  runHeartbeatTick,
  sweepIntervalMs,
} from "./sweep-interval.util";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "addon-lifecycle";

@Injectable()
export class AddonLifecycleJob {
  private readonly logger = new Logger(AddonLifecycleJob.name);
  private inFlight = false;
  private readonly intervalMs = sweepIntervalMs(
    process.env.ADDON_LIFECYCLE_SWEEP_INTERVAL_MS,
  );

  // 显式令牌：bff 打包（esbuild）不产装饰器元数据，隐式构造器类型会静默注入 undefined。
  constructor(
    @Inject(AddonService) private readonly addons: AddonService,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(sweepIntervalMs(process.env.ADDON_LIFECYCLE_SWEEP_INTERVAL_MS))
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      // 心跳 + 「一趟失败不杀 interval」的骨架只有一份（runHeartbeatTick），下一趟自愈。
      await runHeartbeatTick(
        {
          heartbeat: this.heartbeat,
          jobName: JOB_NAME,
          intervalMs: this.intervalMs,
          logger: this.logger,
          label: "addon lifecycle pass",
        },
        () => this.pass(),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /** 返回本趟发出去的通知条数（心跳 items）。 */
  private async pass(): Promise<number> {
    const counts = await this.addons.sweepAddonLifecycle({
      leadDays: envDays("ADDON_LIFECYCLE_LEAD_DAYS", 7),
      backlogDays: envDays("ADDON_LIFECYCLE_BACKLOG_DAYS", 3),
    });
    const total = counts.expiringSoon + counts.exhausted + counts.expired;
    /* 饱和单独报一行：发了 200 条的一趟与「还有没扫到的」的一趟，
       在 items 上长得一模一样，只看条数分不出来。 */
    if (counts.saturated) {
      this.logger.warn(
        "addon lifecycle: this pass was capped — candidates remain unexamined",
      );
    }
    if (total > 0) {
      this.logger.log(
        `addon lifecycle: ${counts.expiringSoon} expiring soon, ` +
          `${counts.exhausted} exhausted, ${counts.expired} expired`,
      );
    }
    return total;
  }
}
