/**
 * invitation-expiry.job.ts — 入组邀请到期的 interval 驱动（2026-09-29）。
 *
 * 为什么是作业而不是写入方的一条尾巴：`tenancy.invitations` 的五个状态里，
 * accepted / declined / revoked 各有确定的写入方，而 **expired 一个都没有**——
 * 「到点没人接」不是任何一次写操作的后果，是时间的后果。此前它只在读侧按
 * `expires_at` 派生（invitation-rules 的 deriveInvitationStatus），库里那一列一直
 * 停在 pending。同形的先例是加油包生命周期与订阅到期扫描；本作业照抄它们的骨架，
 * 不另起一套。
 *
 * 判据与写入都在 @vxture/service-organization 的 sweepExpiredInvitations：
 * 它既把状态改成 `expired` 也通知邀请人（**写状态 + 发通知**这个取舍本仓已有答案——
 * 订阅到期扫描就是这么做的，见 subscription.service 的 sweepExpiredSubscriptions），
 * 本文件只负责节奏、心跳与日志。
 *
 * 全仓的定时作业只住这一个目录，所以这里是唯一落点。作业名进
 * provisioning.background_jobs 是**首趟 tick 自动登记**的（JobHeartbeatService
 * .recordStart 自带 on conflict (job_name) do update），运维台「任务调度」随即可见——
 * 不需要手工建库行、不需要 seed。
 *
 * 环境变量（默认内建，只在调优时覆盖）：
 *   INVITATION_EXPIRY_SWEEP_INTERVAL_MS  节奏（默认 60s，下限 5s，与其它 sweep 同一夹取）
 *   INVITATION_EXPIRY_BACKLOG_DAYS       回看几天内的过期邀请**才通知**（默认 3）——
 *     存量闸门：首趟不许把历史上每一条过期邀请都播一遍（加油包与订阅到期都踩过）。
 *     闸门只闸通知不闸状态：候选查询没有年龄下限，存量的状态一定扫得完。
 *
 * inFlight 只防同实例 tick 叠加；跨实例 / 跨趟的重复由两道挡住——状态那一侧是
 * CAS（只改仍是 pending 的行），通知那一侧是客户收件箱的唯一键。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { OrganizationService } from "@vxture/service-organization";
import { JobHeartbeatService } from "./job-heartbeat.service";
import {
  envDays,
  runHeartbeatTick,
  sweepIntervalMs,
} from "./sweep-interval.util";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "invitation-expiry";

@Injectable()
export class InvitationExpiryJob {
  private readonly logger = new Logger(InvitationExpiryJob.name);
  private inFlight = false;
  private readonly intervalMs = sweepIntervalMs(
    process.env.INVITATION_EXPIRY_SWEEP_INTERVAL_MS,
  );

  // 显式令牌：bff 打包（esbuild）不产装饰器元数据，隐式构造器类型会静默注入 undefined。
  constructor(
    @Inject(OrganizationService) private readonly orgs: OrganizationService,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(sweepIntervalMs(process.env.INVITATION_EXPIRY_SWEEP_INTERVAL_MS))
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
          label: "invitation expiry pass",
        },
        () => this.pass(),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * 返回本趟**改成 expired 的行数**（心跳 items）。
   *
   * items 记状态转移而不是通知条数：这一趟的活是「让库里那一列追上事实」，
   * 通知是它的尾巴。存量闸门之外的行会转移而不通知，两个数字在首趟差得很远——
   * 拿通知条数当 items 会让运维台上一趟正在啃存量的扫描显示成「没干活」。
   */
  private async pass(): Promise<number> {
    const counts = await this.orgs.sweepExpiredInvitations({
      backlogDays: envDays("INVITATION_EXPIRY_BACKLOG_DAYS", 3),
    });
    /* 饱和单独报一行：改了 200 行的一趟与「还有没扫到的」的一趟，
       在 items 上长得一模一样，只看条数分不出来。 */
    if (counts.saturated) {
      this.logger.warn(
        "invitation expiry: this pass was capped — candidates remain unexamined",
      );
    }
    if (counts.expired > 0) {
      this.logger.log(
        `invitation expiry: ${counts.expired} expired, ` +
          `${counts.notified} inviter(s) notified`,
      );
    }
    return counts.expired;
  }
}
