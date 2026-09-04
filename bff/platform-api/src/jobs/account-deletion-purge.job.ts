/**
 * account-deletion-purge.job.ts — 自助删除账号的 30 天保留期到期清扫
 * (050-account §7,owner 2026-09-04 裁定)。
 *
 * 语义:status='deleting' 且 deletion_requested_at 早于 30 天前的用户,先把个人
 * 租户软删(OrganizationService.softDeletePersonalOrg),再脱敏 + 软删账号
 * (AccountService.purgeUser:三标识改成不可再占用的形状、资料 / 凭据 / 三方绑定 /
 * 头像清掉;user_no 永不回收,订单 / 账单 / 审计里的裸 user_id 仍可解引用)。
 *
 * 保留期内撤销删除会把 status 翻回 active,查询条件因此天然排除它;两次清扫撞上
 * 也无害——purgeUser 的 UPDATE 带 status='deleting' and deleted_at is null 的
 * 比较即写,输的那次改零行、返回 false。
 *
 * 节奏走 ACCOUNT_DELETION_PURGE_INTERVAL_MS(默认 15 分钟,下限 1 分钟):这不是
 * 分钟级的到点动作,晚几分钟无感。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { AccountService } from "@vxture/service-account";
import { OrganizationService } from "@vxture/service-organization";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { runHeartbeatTick } from "./sweep-interval.util";

/** provisioning.background_jobs 主键,opera「任务调度」用它认作业。 */
export const JOB_NAME = "account-deletion-purge";

const DEFAULT_INTERVAL_MS = 15 * 60_000;

export function purgeIntervalMs(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 60_000 ? n : DEFAULT_INTERVAL_MS;
}

@Injectable()
export class AccountDeletionPurgeJob {
  private readonly logger = new Logger(AccountDeletionPurgeJob.name);
  private inFlight = false;
  private readonly intervalMs = purgeIntervalMs(
    process.env.ACCOUNT_DELETION_PURGE_INTERVAL_MS,
  );

  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(OrganizationService) private readonly org: OrganizationService,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {}

  @Interval(purgeIntervalMs(process.env.ACCOUNT_DELETION_PURGE_INTERVAL_MS))
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
          label: "account deletion purge",
        },
        () => this.pass(),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /** One pass; returns the number of accounts purged. */
  async pass(): Promise<number> {
    const due = await this.account.listDeletionDue(50);
    let purged = 0;
    for (const userId of due) {
      await this.org.softDeletePersonalOrg(userId);
      if (await this.account.purgeUser(userId)) purged += 1;
    }
    if (purged > 0) {
      this.logger.log(`account deletion purge: ${purged} account(s) purged`);
    }
    return purged;
  }
}
