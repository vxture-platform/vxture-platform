/**
 * operator-signal-sweep.job.ts — 运营侧信号巡检（第二批，owner 2026-09-28）。
 * @package @vxture/bff-platform-api
 *
 * owner：「先把通知、信息、任务、提醒这些信息做全、做多，后续再在订阅选择上做筛选。
 * 本轮需要充分考虑信息完整性。」
 *
 * 一个作业两段，各扫一类，产出都是 `admin.operator_notices` 的系统来源通告：
 *   ① 业务事件（business-event-signals.ts）——注册 / 建组织 / 提认证 / 下单 / 加油包 /
 *      开票 / 评价 / 核销 / 申请注销 / 关自动续费 / 新工单 / 客户回复工单，共 12 类，
 *      每类一条 SQL。
 *   ② 运营动作（audit-event-signals.ts）——`support.audit_logs` 里白名单内的动作码。
 *
 * ── 为什么两段合在一个作业里 ──
 * 它们的节奏、回看窗口、去重机制、失败处置完全一样，拆成两个作业等于把同一件事的
 * 心跳、告警、env 各写两份。两段各自包在 try 里：一段炸了另一段照跑（**不是**跳过
 * 失败——两段都跑完之后把失败抛出去，心跳记 failed，在 opera「任务调度」里显红）。
 *
 * ── 重叠无害，靠去重键而不是靠精确的时间窗 ──
 * 每轮回看 `OPERATOR_SIGNAL_SWEEP_LOOKBACK_MINUTES`（默认 30 分钟）而节奏是 2 分钟，
 * 所以同一行会被扫到十几次。`createSystemNotice` 的 `on conflict do nothing` 打在
 * 部分唯一索引 `uq_operator_notices_system` 上，重扫只会落成 `inserted: false`。
 * 这比「记住上次扫到哪」可靠得多：后者要维护游标，进程重启、时钟回拨、事务可见性
 * 晚到都会造成永久漏扫，而漏掉的那条不报错。
 *
 * ── 首轮把回看压到 10 分钟 ──
 * 否则每次重启（部署、崩溃重启、扩容）都会把过去半小时重放一遍。历史已经由
 * `2026-11-22-backfill-operator-notices.sql` 补过，去重键也挡着；压窗只是让重启
 * 不要在日志里刷出一大片 `inserted: false`。10 分钟仍然覆盖「重启期间发生的事」。
 *
 * ── 上限 ──
 * 每类每轮最多 `OPERATOR_SIGNAL_SWEEP_LIMIT`（默认 200）行。异常放量（批量导入、
 * 回填脚本）时不把通告板冲掉；没扫完的下一轮继续（回看窗口还在）。
 *
 * ── 库角色 ──
 * 本进程连库的角色是 `svc_platform_api`。两段 SQL 碰到的每一个关系都要有权限——
 * Postgres 对语句里**出现过**的每个关系查权限，哪一支返不返回行都一样。新加的读面
 * 逐表最小授权（只 SELECT）写在 `deploy/database/ddl/97_service_roles.sql` 末尾
 * + 活库迁移 `2026-11-23-platform-api-signal-sweep-grants.sql`，两处逐字一致。
 * 2026-09-29 的客户回复那一类新读 `support.ticket_comments`，授权同法
 * （`2026-11-26-platform-api-ticket-comments-grant.sql`）。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  PgNoticeRepository,
  type CreateSystemNoticeInput,
  type CreateSystemNoticeResult,
} from "@vxture/service-notice";
import { COMMERCE_PG_POOL } from "@vxture/service-subscription";
import type { Pool } from "pg";
import {
  BUSINESS_EVENT_PASSES,
  composeBusinessNotice,
  type SignalRow,
} from "../notifications/business-event-signals";
import {
  AUDIT_SWEEP_SQL,
  AUDIT_WHITELIST_CODES,
  composeAuditNotice,
  type AuditSignalRow,
} from "../notifications/audit-event-signals";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { runHeartbeatTick, sweepIntervalMs } from "./sweep-interval.util";

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "operator-signal-sweep";

/** 首轮的回看上限：重启不重放历史（见头注）。 */
export const FIRST_TICK_LOOKBACK_MINUTES = 10;

/** 默认 2 分钟一轮：运营信号不是秒级的，但也不该等到下一个小时。 */
export function signalSweepIntervalMs(): number {
  return sweepIntervalMs(
    process.env.OPERATOR_SIGNAL_SWEEP_INTERVAL_MS ?? "120000",
  );
}

export function lookbackMinutes(): number {
  const raw = Number(process.env.OPERATOR_SIGNAL_SWEEP_LOOKBACK_MINUTES);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 30;
}

export function sweepLimit(): number {
  const raw = Number(process.env.OPERATOR_SIGNAL_SWEEP_LIMIT);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 200;
}

/** 写侧端口：`PgNoticeRepository` / `NoticeService` 都满足；单测注入假实现。 */
export interface SystemNoticeWriter {
  createSystemNotice(
    input: CreateSystemNoticeInput,
  ): Promise<CreateSystemNoticeResult>;
}

export interface SweepOptions {
  readonly lookbackMinutes: number;
  readonly limit: number;
  /** 只为让单测钉住 expires_at；缺省取现在。 */
  readonly now?: Date;
}

export interface SweepPassResult {
  /** 扫出多少行。 */
  readonly scanned: number;
  /** 其中真正写成新通告的条数（其余是去重命中，不是失败）。 */
  readonly inserted: number;
  /** 出错的子段与原因，人话一行一条。空数组 = 全段成功。 */
  readonly failures: readonly string[];
}

/**
 * ① 业务事件巡检：11 类各一条 SQL。
 *
 * 每类各自包在 try 里——一条 SQL 出错（列改名、权限缺失）不该把另外十类也扫没了，
 * 那会让一个局部问题表现成「运营端什么都没有」。错误汇总回调用方，由它抛。
 */
export async function runBusinessEventSweep(
  pool: Pool,
  notices: SystemNoticeWriter,
  opts: SweepOptions,
): Promise<SweepPassResult> {
  const now = opts.now ?? new Date();
  const failures: string[] = [];
  let scanned = 0;
  let inserted = 0;

  for (const pass of BUSINESS_EVENT_PASSES) {
    try {
      /* $1/$2 每类都有；$3 起是那一类自己的判据参数（今天只有工单回复用到，
         绑的是值域里的事件词）。展开而不是各写一条 query，是为了让「这一类多一个
         参数」不需要动 runner 的控制流。 */
      const result = await pool.query<SignalRow>(pass.sql, [
        opts.lookbackMinutes,
        opts.limit,
        ...(pass.extraParams ?? []),
      ]);
      scanned += result.rows.length;
      for (const row of result.rows) {
        const written = await notices.createSystemNotice(
          composeBusinessNotice(pass, row, now),
        );
        if (written.inserted) inserted += 1;
      }
    } catch (err) {
      failures.push(`${pass.code}（${pass.label}）：${String(err)}`);
    }
  }

  return { scanned, inserted, failures };
}

/**
 * ② 运营动作巡检：一条 SQL 扫整张审计表，白名单过滤在库里做（`action = any($2)`）。
 *
 * 白名单外的动作码根本不会被取回来；`composeAuditNotice` 返回 null 那条分支是第二
 * 道保险（有人只改了 SQL 的参数、忘了改表），命中也只是静默跳过，不是错误。
 */
export async function runAuditEventSweep(
  pool: Pool,
  notices: SystemNoticeWriter,
  opts: SweepOptions,
): Promise<SweepPassResult> {
  const now = opts.now ?? new Date();
  const failures: string[] = [];
  let scanned = 0;
  let inserted = 0;

  try {
    const result = await pool.query<AuditSignalRow>(AUDIT_SWEEP_SQL, [
      opts.lookbackMinutes,
      AUDIT_WHITELIST_CODES,
      opts.limit,
    ]);
    scanned = result.rows.length;
    for (const row of result.rows) {
      const input = composeAuditNotice(row, now);
      if (!input) continue;
      const written = await notices.createSystemNotice(input);
      if (written.inserted) inserted += 1;
    }
  } catch (err) {
    failures.push(`audit_logs 巡检：${String(err)}`);
  }

  return { scanned, inserted, failures };
}

@Injectable()
export class OperatorSignalSweepJob {
  private readonly logger = new Logger(OperatorSignalSweepJob.name);
  private inFlight = false;
  private firstTickDone = false;
  private readonly intervalMs = signalSweepIntervalMs();
  private readonly notices: SystemNoticeWriter;

  constructor(
    // 必须显式 @Inject：BFF 打包走 esbuild，它不产 emitDecoratorMetadata。
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(JobHeartbeatService)
    private readonly heartbeat: JobHeartbeatService,
  ) {
    // 与 dispatcher 里的镜像同一手法（`new OperatorMirror(pool, new PgNoticeRepository(pool))`）：
    // 不为写通告另开一条连接池，也不把 NoticeModule 拉进本进程的 DI 图。
    this.notices = new PgNoticeRepository(pool);
  }

  @Interval(signalSweepIntervalMs())
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
          label: "operator signal sweep",
        },
        () => this.pass(),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /** 首轮压到 10 分钟，之后用配置值（见头注）。 */
  private currentLookback(): number {
    const configured = lookbackMinutes();
    if (this.firstTickDone) return configured;
    this.firstTickDone = true;
    return Math.min(configured, FIRST_TICK_LOOKBACK_MINUTES);
  }

  /** @returns 本轮新写入的通告条数（去重命中的不计）。 */
  private async pass(): Promise<number> {
    const opts: SweepOptions = {
      lookbackMinutes: this.currentLookback(),
      limit: sweepLimit(),
    };

    const business = await runBusinessEventSweep(this.pool, this.notices, opts);
    const audit = await runAuditEventSweep(this.pool, this.notices, opts);

    this.logger.log(
      `operator signal sweep（回看 ${opts.lookbackMinutes} 分钟）：` +
        `业务事件 扫 ${business.scanned} 行 / 新增 ${business.inserted} 条，` +
        `运营动作 扫 ${audit.scanned} 行 / 新增 ${audit.inserted} 条`,
    );

    const failures = [...business.failures, ...audit.failures];
    if (failures.length > 0) {
      // 两段都已经跑完才抛：一段坏不该连带另一段不跑，但坏了必须显红——
      // 静默继续正是这批要消灭的那种坏法。
      throw new Error(`${failures.length} 段巡检失败：${failures.join("；")}`);
    }
    return business.inserted + audit.inserted;
  }
}
