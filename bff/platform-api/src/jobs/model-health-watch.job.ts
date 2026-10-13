/**
 * model-health-watch.job.ts — 模型服务健康巡检（#562）。
 * @package @vxture/bff-platform-api
 *
 * 平台侧的无人值守 watchdog：周期性读 Atlas 的 `/s2s/health`，把其中的欠费 / 宕机 /
 * 路由不可用 / 限流翻成 `admin.operator_notices` 的系统通告（`composeModelHealthNotices`），
 * 让运营在没人盯着页面时也看得见。此前平台对 Atlas 的健康信号零消费——6 条坏路由在产、
 * tenderforge 两天静默丢了 180/188 次调用都没人被通知（见 issue #562）。
 *
 * ── 为什么在 platform-api ──
 * 它要的是无会话、无租户的后台巡检，而 opera/admin 的 Atlas 代理都要 operator 登录态。
 * platform-api 用自己的机密客户端（health-reader grant）铸 `health:atlas` 票读健康，
 * 这是唯一不需要人坐在那儿的通路。
 *
 * ── 重叠无害，靠去重键 ──
 * 每轮取全量快照，`createSystemNotice` 的 `on conflict do nothing` 打在
 * `uq_operator_notices_system` 上，一条持续坏的路由只落一条通告，重扫只是 `inserted: false`。
 * 不记游标（同 operator-signal-sweep 的理由）。
 *
 * ── 失败要有声音 ──
 * 读健康抛了就让 `pass()` 抛出去：心跳记 failed，opera「任务调度」显红，job-health-alert
 * 再发一条「监测自己停了」。监测瞎了绝不能一路绿着（未配 secret 是例外——那是正常中间态，
 * 由 client 返回 null、这里记一条 log 跳过）。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { PgNoticeRepository } from "@vxture/service-notice";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import type { Pool } from "pg";

import { AtlasHealthClient } from "../notifications/atlas-health.client";
import { composeModelHealthNotices } from "../notifications/model-health-notice";
import {
  writeOpsNotice,
  type SystemNoticeWriter,
} from "../notifications/ops-notice";
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
    // 必须显式 @Inject：BFF 打包走 esbuild，它不产 emitDecoratorMetadata。
    // pool 只在构造里包成 notices（同 operator-signal-sweep 的手法），不留字段。
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
      // 未配 secret：client 已记 log，本轮按 0 条正常收尾（不是失败）。
      return 0;
    }
    const inputs = composeModelHealthNotices(view, new Date());
    let inserted = 0;
    for (const input of inputs) {
      // writeOpsNotice 永不抛：去重命中与写失败都只记 log，不中断整轮。
      await writeOpsNotice(this.notices, input, this.logger, input.referenceId);
    }
    inserted = inputs.length;
    this.logger.log(
      `model health watch：快照 models ${view.models.length} / routes ${view.routes.length} ` +
        `/ vendors ${view.vendors.length} / atlas ${view.atlas.length}，` +
        `产出通告 ${inputs.length} 条（去重后按库为准）。`,
    );
    return inserted;
  }
}
