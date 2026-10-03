/**
 * ops-todo-alert.job.ts — 运营待办告警巡检（#231，owner 2026-09-08 定档；2026-09-28 根治批改读共享算法）。
 * @package @vxture/bff-platform-api
 *
 * 扫停留过久的九类待办（2026-09-28 第三批从三类扩到九类），按 4h 静默窗口发邮件给
 * 在用运营账号：
 *   · confirm_payment         —— 客户已申报付款，等运营确认收款（客户的钱在等着）
 *   · reprovision             —— 钱已到、权益没开通（2026-09-08 事故就是这一类）
 *   · refund_audit            —— 客户申请退款，等运营审核（此前退款单挂着无人知）
 *   · refund_execute          —— 审过了、钱还没退出去
 *   · refund_processing_stuck —— 退款卡在处理中
 *   · refund_failed           —— 退款失败，客户的钱没回去
 *   · addon_pending_confirm   —— 加油包申报了款，等运营核销
 *   · ticket_sla              —— 工单首次响应已超时
 *   · maintenance_overdue     —— 维护窗口过了计划结束时间还挂着（客户还被拦着）
 * 「部分收款尾款挂账」不在此列：那一类在等客户，不在等运营。
 * 自愈放弃是另一条告警，由 OrderService 在放弃点直接报（见 ops-alerter.ts），不在这里扫。
 *
 * ── 升档另写一条运营通告 ──
 * 待办自己带「等太久了」的位（`escalated` / `escalationStep`，算在共享算法的 SQL 里）。
 * 邮件有 4h 静默窗口、且漏看就没了；所以升档的那些**另外**写一条 critical 运营通告，
 * 留在运营台的列表里直到有人读它。每跨过一个阈值倍数写一条（去重键带 step），
 * 于是一件事拖得越久，台面上的 critical 就越多——而不是同一条被静默吞掉。
 * ALERT_KINDS 那九类在 OperatorAlertsWiring.alertTodo 里做（邮件 + 通告两半在一处）。
 *
 * ── 通告覆盖全（2026-10-04，owner 裁定 3「通告尽量覆盖全」）──
 * 此前只有四类有升档阈值、且通告半只覆盖 ALERT_KINDS：九类里六类升不了档，`verification`
 * 升了档也没有通告。现在共享算法里**十类**有阈值（六类新加，默认值见
 * service-ops-todos 的 `opsTodoThresholds`），而有阈值却不在 ALERT_KINDS 的类别走
 * NOTICE_ONLY_KINDS：只写通告（OperatorAlertsWiring.noticeEscalatedTodo，与 alertTodo 的
 * 通告半同一函数 composeEscalatedTodoNotice），一封邮件都不发——邮件半仍是 owner 未裁的
 * 事（check-ops-todo-alerts 的 UNRULED 没动）。
 * `verification` 进得了本进程，是因为它那一段 SQL 自 2026-10-04 起从 tenant_base 拆出，
 * 只碰 tenancy.* 与 kyc.tenant_verifications（97 末尾已授 SELECT，2026-11-23 迁移灌活库），
 * 零授权变更；itest 里 `set role svc_platform_api` 那条用例跑的就是本作业的两种调用形状。
 * 守卫第 7 段对账：SQL 里有阈值的每一类都必须在 ALERT_KINDS ∪ NOTICE_ONLY_KINDS 里。
 *
 * ── 通告类别为什么另起一拼 ──
 * `list` 的 limit 50 按 rose 优先、等得最久优先取。通告只写给升档行，而 verification 的
 * 基准档是 amber——一旦 rose 待办 ≥ 50 条，amber 行永远挤不进同一拼，通告半个都没有且
 * 不报错。所以 NOTICE_ONLY_KINDS 单独 list 一次，两拼各自 50。
 *
 * ── 读的是哪一份 ──
 * `@vxture/service-ops-todos` 的 OpsTodoRepository——admin 待办页读的也是它。此前作业自己
 * 在 OrderService.listOpsTodoOrders 里另写一套谓词，页面在浏览器里再派生一套，两边各写各的
 * 谁也不认识谁；现在判据只有一处，这里只挑类别、停留时长与上限。
 * 哪几类要告警是 owner 的裁定，`scripts/guardrails/check-ops-todo-alerts.mjs` 读下面的
 * ALERT_KINDS 与共享算法的类别表对账。
 *
 * ── 为什么这里传 includeApplicant: false ──
 * 本进程的库角色是 `svc_platform_api`，只有 7 个 schema（metering / product / sharing /
 * provisioning / tenancy / billing / promotion，见 deploy/database/ddl/97_service_roles.sql）。
 * Postgres 对 SQL 里**出现过的每一个关系**查权限——哪一支返不返回行都一样——所以一条
 * 顺手 join 了 `account.users`（申报人）或 `admin.risk_records`（租户风险档）的待办查询
 * 在本机（owner 连库）畅通无阻，到生产就是 42501，整轮作业失败。
 * 而告警邮件一个都不用这两样（todoAlertInput 只取 tenant.name / amount / product /
 * waitingSince），所以整块不要：仓储据此**不把那些 join 放进文本**。
 *
 * ── 为什么是状态扫描而不是事件触发 ──
 * `paid` 是每张正常订单都会瞬间路过的中间态（收款 → 履约同一轮内完成），
 * 进入即告警会对**每一张成功的订单**都发一封。所以判据是「在这个状态里停了多久」，
 * 由 OPS_TODO_ALERT_MIN_AGE_MINUTES（默认 15 分钟）兜住，自愈也有了它的窗口。
 * 顺带的好处：部署之前就卡住的存量单同样会被扫到——事件触发的做法漏的正是这些。
 *
 * ── 有待办却无人可达 = 作业失败 ──
 * 一个 email_verified 的在用运营账号都没有时，本轮 throw，让心跳记成失败、
 * 在 opera「任务调度」里显红。这不是过度反应：待办堆着、通知发不出去，
 * 本身就是坏的，而它恰恰是那种不报错的坏法（#231 的病根）。
 */
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { OpsTodoRepository, type OpsTodoKind } from "@vxture/service-ops-todos";
import { OperatorAlertsWiring } from "../notifications/operator-alerts.wiring";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { runHeartbeatTick, sweepIntervalMs } from "./sweep-interval.util";

/**
 * owner 裁定要告警的类别。改这里等于改裁定——`check-ops-todo-alerts` 会拿它对账，
 * 且 OperatorAlertsWiring.alertTodo 对不在此列的类别直接抛。
 *
 * ── 2026-09-28 第三批的裁定规则 ──
 * **严重度恒为 rose 的类别推邮件**，其余只上页面。rose 在这套契约里的意思就是「有人
 * 在等、而且等的是钱或是服务」——那正是值得在工作时间外打扰运营的那一档。
 * 逐个写出来而不是从算法里算（`kinds.filter(rose)`）：这是一张**裁定表**，
 * 谁要多收一封邮件就得在这里改一行，而不是顺手把某一类的严重度调红就自动开始发信。
 *
 * `risk` 与 `ticket` 的严重度**随行变**（风险档 high / 工单 p0 才 rose），所以那条规则
 * 对它们不成立，仍留在守卫的 UNRULED 里等 owner 裁定；`ticket_sla` 不同——它是本批
 * 新立的类别、恒 rose，且问的事情明确（首次响应已超时）。
 */
export const ALERT_KINDS: readonly OpsTodoKind[] = [
  "confirm_payment",
  "reprovision",
  "refund_audit",
  "refund_execute",
  "refund_processing_stuck",
  "refund_failed",
  "addon_pending_confirm",
  "ticket_sla",
  "maintenance_overdue",
];

/**
 * 只写通告、不发邮件的类别（2026-10-04 owner 裁定 3「通告尽量覆盖全」）。
 *
 * 放这里的是「有升档阈值、而邮件半未被 owner 裁定」的类别：升档了就另写一条 critical
 * 运营通告（noticeEscalatedTodo），邮件一封不发。`verification` 的邮件半仍在守卫的
 * UNRULED 里——这张表不替 owner 裁邮件；要推邮件得先搬进 DECIDED 再进 ALERT_KINDS。
 * `check-ops-todo-alerts` 第 7 段拿它与 ALERT_KINDS 的并集对账 SQL 里有阈值的类别：
 * 有阈值却两边都不在 = 升档了也没人写通告，当场红。
 */
export const NOTICE_ONLY_KINDS: readonly OpsTodoKind[] = ["verification"];

/** 待办要停留多久才值得打扰运营。 */
const minAgeMinutes = (): number => {
  const raw = Number(process.env.OPS_TODO_ALERT_MIN_AGE_MINUTES);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 15;
};

/** 一轮最多告警多少条——异常放量时别把邮箱打爆。 */
const SCAN_LIMIT = 50;

/** 默认 5 分钟一轮：待办不是分钟级紧急，60s 巡检没意义。 */
const intervalOf = (): number =>
  sweepIntervalMs(process.env.OPS_TODO_ALERT_INTERVAL_MS ?? "300000");

/** provisioning.background_jobs 主键，opera「任务调度」用它认作业。 */
export const JOB_NAME = "ops-todo-alert";

@Injectable()
export class OpsTodoAlertJob {
  private readonly logger = new Logger(OpsTodoAlertJob.name);
  private inFlight = false;
  private readonly intervalMs = intervalOf();

  constructor(
    @Inject(OpsTodoRepository) private readonly todos: OpsTodoRepository,
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
          label: "ops todo alert",
        },
        () => this.pass(),
      );
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * @returns 本轮实际发出的告警条数（邮件命中静默窗口的不计）+ 只写通告那一拼里升档的条数。
   */
  private async pass(): Promise<number> {
    const shape = {
      minAgeMinutes: minAgeMinutes(),
      limit: SCAN_LIMIT,
      // 申报人与租户风险档来自本进程角色碰不到的 schema，且邮件 / 通告都用不到——见头注。
      includeApplicant: false,
    } as const;
    const todos = await this.todos.list({ kinds: ALERT_KINDS, ...shape });
    // 另起一拼，不并进上面那拼：limit 50 按 rose 优先取，amber 的通告类别会被挤没——见头注。
    const noticeOnly = await this.todos.list({
      kinds: NOTICE_ONLY_KINDS,
      ...shape,
    });
    if (todos.length === 0 && noticeOnly.length === 0) return 0;

    let alerted = 0;
    let unreachable = 0;
    for (const todo of todos) {
      const result = await this.alerts.alertTodo(todo);
      if (result.noRecipient) unreachable += 1;
      else if (result.sent > 0) alerted += 1;
    }

    let noticed = 0;
    for (const todo of noticeOnly) {
      // 没升档的只上页面；升档的才写通告（去重键带 step，同一级只落一条）。
      if (!todo.escalated) continue;
      await this.alerts.noticeEscalatedTodo(todo);
      noticed += 1;
    }

    if (alerted > 0) {
      this.logger.log(
        `ops todo alert: ${alerted}/${todos.length} 条待办已通知运营（其余在 4h 静默窗口内）`,
      );
    }
    if (noticed > 0) {
      this.logger.log(
        `ops todo alert: ${noticed}/${noticeOnly.length} 条只写通告的待办已升档，通告已写（同级去重）`,
      );
    }
    if (unreachable > 0) {
      // 已发出去的那些不回滚（邮件发了就是发了）；抛出去只为把这个洞顶到台前。
      throw new Error(
        `${unreachable} 条待办无人可达：没有 status=active 且 email_verified 的运营账号。` +
          "请在运营台「运营账号」里补齐并验证邮箱，否则待办通知永远发不出去。",
      );
    }
    return alerted + noticed;
  }
}
