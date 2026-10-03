/**
 * account-deletion-purge.job.ts — 自助删除账号的 30 天保留期到期清扫
 * (050-account §7,owner 2026-09-04 裁定)。
 *
 * 语义:status='deleting' 且 deletion_requested_at 早于 30 天前的用户,**先**脱敏 +
 * 软删账号(AccountService.purgeUser:三标识改成不可再占用的形状、资料 / 凭据 /
 * 三方绑定 / 头像清掉;user_no 永不回收,订单 / 账单 / 审计里的裸 user_id 仍可解引用),
 * **成功了再**把个人租户软删(OrganizationService.softDeletePersonalOrg)。
 *
 * 两次清扫撞上无害——purgeUser 的 UPDATE 带 status='deleting' and deleted_at is null
 * 的比较即写,输的那次改零行、返回 false。
 *
 * ── 2026-10-03 改了顺序,并更正这里原来的一句话 ──
 * 原来是「先软删个人租户,再 purgeUser」,而这一段原本写着「保留期内撤销删除会把
 * status 翻回 active,**查询条件因此天然排除它**」。那句话只在**取数那一刻**成立:
 * 候选集按 status='deleting' 选,而 `softDeletePersonalOrg` 那条 UPDATE
 * (`where owner_user_id = $1 and type = 'personal' and deleted_at is null`)
 * **不带任何「此刻仍在删除中」的条件** —— 读侧的判据没跟到写侧。
 *
 * 而保留期内是**允许登录、也允许撤销删除**的(`READABLE_STATUS_SQL` 放行
 * `status in ('active','deleting')`,那里的注释写明了)。一趟最多 50 个、每个都是
 * 「一条 tenants UPDATE + 一个多语句事务」,所以撤销完全来得及插在中间:
 * 结果是账号留在 active,而他的个人租户被软删。
 *
 * 现在 purgeUser 的 CAS 当门(见 `pass()`),撤销过的人在那一步就被挡住。
 * 上面那句「天然排除」因此才真的成立 —— 排除它的是 CAS,不是查询条件。
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

  /**
   * One pass; returns the number of accounts purged.
   *
   * ── 顺序要紧：CAS 先行，它是后面每一步的门（2026-10-03 改） ──
   * 原来是先无条件 `softDeletePersonalOrg(userId)`、再 `purgeUser(userId)`。
   * 候选集是 `status = 'deleting'` 选出来的，而那条租户软删**不带任何「此刻仍在删除中」
   * 的条件** —— 读侧的判据没跟到写侧。
   *
   * 而保留期内**允许登录、也允许撤销删除**（`READABLE_STATUS_SQL` 放行
   * `status in ('active','deleting')`，注释写明了这一点）。于是撤销与这一趟撞上时：
   * 账号留在 active，而他的**个人租户被软删**；`purgeUser` 回的 false 被丢掉，
   * 一行日志都没有 —— 「什么都没做」与「把一个活账号的租户删了」在日志里长得一模一样。
   *
   * 现在把 `purgeUser` 的 CAS（`where id = $1 and status = 'deleting'`，事务内，
   * 不匹配就 rollback 回 false）挪到前面当门：撤销过的人在这一步就被挡住，后面一步不跑。
   *
   * 两种半态比一比，这也是更好的那一侧：
   *   · 原顺序中途失败 → **活账号丢了个人租户**（人还在用，工作空间没了）；
   *   · 现顺序中途失败 → 已脱敏已禁登的账号留一个孤儿个人租户（人已经走了，
   *     租户悬着但无害，且 `owner_user_id` 指着一个 deleted 的用户，查得出来）。
   * 后者下一趟不会自愈（CAS 已经把 status 改掉了），所以单独记一行 error，
   * 而不是留给日志里的沉默。
   */
  async pass(): Promise<number> {
    const due = await this.account.listDeletionDue(50);
    let purged = 0;
    let cancelled = 0;
    for (const userId of due) {
      /* CAS 当门：撤销过的人在这里就 false，个人租户一个字都不动。 */
      if (!(await this.account.purgeUser(userId))) {
        cancelled += 1;
        continue;
      }
      try {
        await this.org.softDeletePersonalOrg(userId);
      } catch (err) {
        /* 账号已脱敏，这一步失败留下孤儿个人租户，而且下一趟捞不到他（status 已变）
           —— 必须有声音，不能靠日志里的沉默。 */
        this.logger.error(
          `account deletion purge: 账号已清理但个人租户没删掉，留下一个孤儿租户 ` +
            `（owner_user_id=${userId}）：${String(err)}`,
        );
      }
      purged += 1;
    }
    if (purged > 0) {
      this.logger.log(`account deletion purge: ${purged} account(s) purged`);
    }
    if (cancelled > 0) {
      /* 取数之后被撤销（或被别的实例抢先清理）的条数。原来这个数字一行都不记，
         于是「这一趟什么都没做」与「这一趟本来该清 40 个」看起来一样。 */
      this.logger.log(
        `account deletion purge: ${cancelled} 个在取数之后已不是 deleting（撤销删除 ` +
          `或已被别的实例清理），本趟跳过，个人租户未动`,
      );
    }
    return purged;
  }
}
