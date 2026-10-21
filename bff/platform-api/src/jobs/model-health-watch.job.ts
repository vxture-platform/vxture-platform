/**
 * model-health-watch.job.ts - Unattended Atlas snapshot monitoring.
 * @package @vxture/bff-platform-api
 * @layer Application
 * @category job
 * @author AI-Generated
 * @date 2026-10-19
 * Failed reads, missing credentials and notice writes fail the heartbeat.
 * Durable transitions, liveness and recoveries survive process restarts.
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { AtlasHealthClient } from "../notifications/atlas-health.client";
import { healthSnapshotSubjects } from "../notifications/model-health-notice";
import { HealthWatchRepository } from "../notifications/health-watch.repository";
import type { HealthEvent } from "../notifications/health-watch.types";
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

  constructor(
    // esbuild does not emit constructor metadata; keep injection explicit.
    @Inject(HealthWatchRepository)
    private readonly store: HealthWatchRepository,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
    @Inject(AtlasHealthClient)
    private readonly atlas: AtlasHealthClient,
  ) {}

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
    const result = await this.store.exclusive(async (client, checkpoint) => {
      const alive = await this.atlas.isAlive();
      const livenessNotices = await this.store.liveness(
        client,
        alive,
        checkpoint,
      );
      if (!alive) throw new Error("Atlas liveness probe failed");
      const events: HealthEvent[] = [];
      let cursor = checkpoint.cursor;
      const seen = new Set<string>();
      const deadline =
        Date.now() + Math.min(60_000, Math.max(5_000, this.intervalMs / 2));
      for (let pageNumber = 0; ; pageNumber++) {
        // Refuse an unbounded/broken feed without committing a partial cursor.
        if (pageNumber >= 500 || Date.now() >= deadline)
          throw new Error("Atlas event drain exceeded its page budget");
        const page = await this.atlas.getEvents(cursor);
        events.push(...page.items);
        if (page.nextCursor !== null && page.items.length > 0) {
          if (seen.has(page.nextCursor))
            throw new Error("Atlas event feed repeated a cursor");
          seen.add(page.nextCursor);
        }
        cursor = page.nextCursor;
        if (page.items.length < 200) break;
      }
      const view = await this.atlas.getHealth();
      if (!view) throw new Error("Atlas health snapshot is unavailable");
      return (
        livenessNotices +
        (await this.store.apply(
          client,
          checkpoint,
          events,
          cursor,
          healthSnapshotSubjects(view),
        ))
      );
    });
    return result ?? 0;
  }
}
