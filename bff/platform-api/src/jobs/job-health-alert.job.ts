/**
 * job-health-alert.job.ts — 后台作业健康巡检（#231 第二段，owner 2026-09-08 定档）。
 * @package @vxture/bff-platform-api
 *
 * 扫 provisioning.background_jobs，把两种坏法报给运营(邮件，4h 静默窗口)：
 *   · failed  —— 上一轮执行失败（至少还留下 last_error）
 *   · stalled —— 早就不动了（什么都不留：run_count 不涨、failure_count 也不涨，
 *                看上去和「最近没事干」一模一样）。判据见 job-health.ts。
 *
 * ── 它扫的表里有它自己 ──
 * 这不是缺陷，是刻意的：本作业失败时，**下一轮的自己**会把上一轮的失败报出去
 * （tick 内 recordStart 已把 status 置 running，扫到的 failed 只可能是上一轮的结论）。
 * 唯一盖不住的是它自己**静默**——死了就没有下一轮。这一层没有进程内的解法：
 * 要真盯住得靠外部探针(deploy/scripts 的 51-check-platform-alerts.sh 那条线)。
 * 与其假装覆盖，不如在这里写清楚边界。
 *
 * ── 无人可达时不抛 ──
 * OpsTodoAlertJob 在「有待办却无人可达」时抛错、把自己标成失败,好在 opera 里显红。
 * 本作业不这么做:它一旦标失败,下一轮就会把自己当作告警对象报出去,变成自我指涉的噪音。
 * 无人可达只记 error 日志——那个洞由 OpsTodoAlertJob 那侧负责顶出来。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PROVISIONING_PG_POOL } from "@vxture/service-provisioning";
import type { Pool } from "pg";
import { OperatorAlertsWiring } from "../notifications/operator-alerts.wiring";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { classifyJob, stallThresholdMs, type JobHealthRow } from "./job-health";
import { runHeartbeatTick, sweepIntervalMs } from "./sweep-interval.util";

/** 默认 5 分钟一轮——和静默阈值的下限同量级，再密没有意义。 */
const intervalOf = (): number =>
  sweepIntervalMs(process.env.JOB_HEALTH_ALERT_INTERVAL_MS ?? "300000");

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "job-health-alert";

@Injectable()
export class JobHealthAlertJob {
  private readonly logger = new Logger(JobHealthAlertJob.name);
  private inFlight = false;
  private readonly intervalMs = intervalOf();
  /** 本进程启动时刻——启动宽限要用（@Interval 是过一个周期才首次触发）。 */
  private readonly bootedAt = Date.now();

  constructor(
    @Inject(PROVISIONING_PG_POOL) private readonly pool: Pool,
    @Inject(OperatorAlertsWiring)
    private readonly alerts: OperatorAlertsWiring,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(intervalOf())
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
          label: "job health alert",
        },
        () => this.pass(),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /** @returns 本轮实际发出的告警条数（命中静默窗口的不计）。 */
  private async pass(): Promise<number> {
    const res = await this.pool.query<{
      job_name: string;
      status: string;
      interval_ms: number | null;
      last_started_at: Date | null;
      last_error: string | null;
      failure_count: string;
    }>(
      `select job_name, status, interval_ms, last_started_at, last_error, failure_count
         from provisioning.background_jobs
        order by job_name`,
    );

    const now = Date.now();
    const uptimeMs = now - this.bootedAt;
    let alerted = 0;
    let unreachable = 0;

    for (const r of res.rows) {
      const row: JobHealthRow = {
        jobName: r.job_name,
        status: r.status,
        intervalMs: r.interval_ms,
        lastStartedAt: r.last_started_at,
        lastError: r.last_error,
        failureCount: Number(r.failure_count),
      };
      const verdict = classifyJob(row, now, uptimeMs);
      if (verdict === "ok") continue;

      const result = await this.alerts.alertJobHealth({
        verdict,
        jobName: row.jobName,
        idleMs: row.lastStartedAt ? now - row.lastStartedAt.getTime() : 0,
        thresholdMs: stallThresholdMs(row.intervalMs),
        intervalMs: row.intervalMs,
        lastError: row.lastError,
        failureCount: row.failureCount,
      });
      if (result.noRecipient) unreachable += 1;
      else if (result.sent > 0) alerted += 1;
    }

    if (alerted > 0) {
      this.logger.log(`job health alert: ${alerted} 条作业异常已通知运营`);
    }
    if (unreachable > 0) {
      // 见文件头：这里只记日志，不抛——抛了会把自己变成下一轮的告警对象。
      this.logger.error(
        `${unreachable} 条作业异常无人可达:没有 status=active 且 email_verified 的运营账号。`,
      );
    }
    return alerted;
  }
}
