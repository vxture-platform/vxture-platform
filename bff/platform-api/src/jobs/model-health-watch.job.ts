/**
 * model-health-watch.job.ts - Unattended Atlas snapshot monitoring.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category job
 * @author AI-Generated
 * @date 2026-10-19
 * Failed reads, missing credentials and notice writes fail the heartbeat.
 * Snapshot deduplication does not yet implement recovery or recurring episodes.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PgNoticeRepository } from "@vxture/service-notice";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import type { Pool } from "pg";

import { AtlasHealthClient } from "../notifications/atlas-health.client";
import { composeModelHealthNotices } from "../notifications/model-health-notice";
import { type SystemNoticeWriter } from "../notifications/ops-notice";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { runHeartbeatTick, sweepIntervalMs } from "./sweep-interval.util";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "model-health-watch";

/** 默认 2 分钟一轮：模型健康不是秒级的，但两天没人知道也不行。 */
export function modelHealthWatchIntervalMs(): number {
  return sweepIntervalMs(
    process.env.MODEL_HEALTH_WATCH_INTERVAL_MS ?? "120000",
  );
}

@Injectable()
export class ModelHealthWatchJob {
  private readonly logger = new Logger(ModelHealthWatchJob.name);
  private inFlight = false;
  private readonly intervalMs = modelHealthWatchIntervalMs();
  private readonly notices: SystemNoticeWriter;

  constructor(
    // esbuild does not emit constructor metadata; keep injection explicit.
    @Inject(COMMERCE_PG_POOL) pool: Pool,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
    @Inject(AtlasHealthClient)
    private readonly atlas: AtlasHealthClient,
  ) {
    this.notices = new PgNoticeRepository(pool);
  }

  @Interval(modelHealthWatchIntervalMs())
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
          label: "model health watch",
        },
        () => this.pass(),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /** @returns 本轮新写入的通告条数（去重命中的不计）。读健康失败则抛（心跳记 failed）。 */
  private async pass(): Promise<number> {
    const view = await this.atlas.getHealth();
    if (!view) {
      throw new Error("Atlas health snapshot is unavailable");
    }
    const inputs = composeModelHealthNotices(view, new Date());
    let inserted = 0;
    let failed = 0;
    for (const input of inputs) {
      try {
        const result = await this.notices.createSystemNotice(input);
        if (result.inserted) inserted++;
      } catch {
        // Attempt the remaining notices; retry failed writes on the next tick.
        failed++;
      }
    }
    if (failed > 0) {
      throw new Error(
        `Model health notice writes failed: ${failed}; inserted: ${inserted}`,
      );
    }
    this.logger.log(
      `model health watch：快照 models ${view.models.length} / routes ${view.routes.length} ` +
        `/ vendors ${view.vendors.length} / atlas ${view.atlas.length}，` +
        `新写入通告 ${inserted} 条，候选 ${inputs.length} 条。`,
    );
    return inserted;
  }
}
