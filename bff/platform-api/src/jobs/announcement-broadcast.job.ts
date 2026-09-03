/**
 * announcement-broadcast.job.ts — 公告推送（P2-h，design_notification_100「公告推送」）。
 *
 * 每 tick：admin.announcements 里 published、publish_at 到点、未过期、未广播过的公告 →
 * 按 target_tenant_types / target_plans 圈租户 → 每个租户 owner 一条站内消息（+ 按偏好 product
 * 主题发邮件，默认只站内）→ 打 meta.broadcast_at。收件人级 inbox 唯一键兜底幂等。
 * 宿主模式同其它作业（runHeartbeatTick）；ANNOUNCEMENT_BROADCAST_INTERVAL_MS 调频率（默认 60s）。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import type { Pool } from "pg";
import { broadcastAnnouncements } from "@vxture/service-notification";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { runHeartbeatTick, sweepIntervalMs } from "./sweep-interval.util";
import { CustomerNotificationsWiring } from "../notifications/customer-notifications.wiring";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "announcement-broadcast";

@Injectable()
export class AnnouncementBroadcastJob {
  private readonly logger = new Logger(AnnouncementBroadcastJob.name);
  private inFlight = false;
  private readonly intervalMs = sweepIntervalMs(
    process.env.ANNOUNCEMENT_BROADCAST_INTERVAL_MS,
  );

  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(CustomerNotificationsWiring)
    private readonly notifications: CustomerNotificationsWiring,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(sweepIntervalMs(process.env.ANNOUNCEMENT_BROADCAST_INTERVAL_MS))
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
          label: "announcement broadcast",
        },
        async () => {
          const s = await broadcastAnnouncements(
            this.pool,
            this.notifications.dispatcher,
            { logger: this.logger },
          );
          if (s.announcements > 0) {
            this.logger.log(
              `announcement broadcast: ${s.announcements} announcement(s) → ${s.tenants} tenant(s), ${s.inboxCreated} inbox, ${s.emailsSent} email`,
            );
          }
          return s.inboxCreated;
        },
      );
    } finally {
      this.inFlight = false;
    }
  }
}
