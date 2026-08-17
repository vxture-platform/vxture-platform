/**
 * job-heartbeat.service.ts — 后台任务心跳写入。
 * @package @vxture/bff-platform-api
 *
 * 四个 @Interval 作业（provisioning-dispatch / sharing-expiry / trial-expiry /
 * order-payment-expiry）各自在 tick 首尾调用，原地 UPSERT 一行到
 * provisioning.background_jobs——是"这个作业现在活着吗、上次跑得怎么样"的当前态，
 * 不是逐 tick 追加的执行日志（最短 10s 一跳的作业逐条落库一天上万行，见该表 DDL
 * 表头注）。复用 ProvisioningModule 导出的 PROVISIONING_PG_POOL，不为一张心跳表
 * 单开一条连接。
 *
 * 心跳写入失败绝不能拖垮作业本身的真实工作——三个方法各自吞掉写库异常只记日志，
 * 调用方（各 job 的 tick()）不需要为心跳单独包一层 try/catch。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PROVISIONING_PG_POOL } from "@vxture/service-provisioning";
import type { Pool } from "pg";

@Injectable()
export class JobHeartbeatService {
  private readonly logger = new Logger(JobHeartbeatService.name);

  constructor(@Inject(PROVISIONING_PG_POOL) private readonly pool: Pool) {}

  async recordStart(jobName: string, intervalMs: number): Promise<void> {
    try {
      await this.pool.query(
        `insert into provisioning.background_jobs
           (job_name, status, interval_ms, last_started_at, updated_at)
         values ($1, 'running', $2, now(), now())
         on conflict (job_name) do update set
           status = 'running',
           interval_ms = excluded.interval_ms,
           last_started_at = now(),
           updated_at = now()`,
        [jobName, intervalMs],
      );
    } catch (err) {
      this.logger.warn(
        `heartbeat recordStart failed for ${jobName}: ${String(err)}`,
      );
    }
  }

  async recordSuccess(
    jobName: string,
    durationMs: number,
    itemsProcessed: number,
  ): Promise<void> {
    try {
      await this.pool.query(
        `update provisioning.background_jobs
         set status = 'success',
             last_finished_at = now(),
             last_duration_ms = $2,
             last_items_processed = $3,
             last_error = null,
             run_count = run_count + 1,
             updated_at = now()
         where job_name = $1`,
        [jobName, durationMs, itemsProcessed],
      );
    } catch (err) {
      this.logger.warn(
        `heartbeat recordSuccess failed for ${jobName}: ${String(err)}`,
      );
    }
  }

  async recordFailure(
    jobName: string,
    durationMs: number,
    error: string,
  ): Promise<void> {
    try {
      await this.pool.query(
        `update provisioning.background_jobs
         set status = 'failed',
             last_finished_at = now(),
             last_duration_ms = $2,
             last_error = $3,
             failure_count = failure_count + 1,
             updated_at = now()
         where job_name = $1`,
        [jobName, durationMs, error.slice(0, 1024)],
      );
    } catch (err) {
      this.logger.warn(
        `heartbeat recordFailure failed for ${jobName}: ${String(err)}`,
      );
    }
  }
}
