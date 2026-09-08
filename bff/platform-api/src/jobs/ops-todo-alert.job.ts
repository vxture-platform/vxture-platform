/**
 * ops-todo-alert.job.ts — 运营待办告警巡检（#231，owner 2026-09-08 定档）。
 * @package @vxture/bff-platform-api
 *
 * 扫两类停留过久的订单态待办，按 4h 静默窗口发邮件给在用运营账号：
 *   · pending_verify —— 客户已申报付款，等运营确认收款（客户的钱在等着）
 *   · paid           —— 钱已到、权益没开通（2026-09-08 事故就是这一类）
 * 「部分收款尾款挂账」不在此列：那一类在等客户，不在等运营。
 * 自愈放弃是第三条告警，由 OrderService 在放弃点直接报（见 ops-alerter.ts），不在这里扫。
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
import { OrderService } from "@vxture/service-subscription";
import { OperatorAlertsWiring } from "../notifications/operator-alerts.wiring";
import { JobHeartbeatService } from "./job-heartbeat.service";
import { runHeartbeatTick, sweepIntervalMs } from "./sweep-interval.util";

/** 待办要停留多久才值得打扰运营。 */
const minAgeMinutes = (): number => {
  const raw = Number(process.env.OPS_TODO_ALERT_MIN_AGE_MINUTES);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 15;
};

/** 一轮最多告警多少单——异常放量时别把邮箱打爆。 */
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
    @Inject(OrderService) private readonly orders: OrderService,
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

  /** @returns 本轮实际发出的告警条数（命中静默窗口的不计）。 */
  private async pass(): Promise<number> {
    const rows = await this.orders.listOpsTodoOrders(
      minAgeMinutes(),
      SCAN_LIMIT,
    );
    if (rows.length === 0) return 0;

    let alerted = 0;
    let unreachable = 0;
    for (const row of rows) {
      const result = await this.alerts.alertOrderTodo(row);
      if (result.noRecipient) unreachable += 1;
      else if (result.sent > 0) alerted += 1;
    }

    if (alerted > 0) {
      this.logger.log(
        `ops todo alert: ${alerted}/${rows.length} 条待办已通知运营（其余在 4h 静默窗口内）`,
      );
    }
    if (unreachable > 0) {
      // 已发出去的那些不回滚（邮件发了就是发了）；抛出去只为把这个洞顶到台前。
      throw new Error(
        `${unreachable} 条待办无人可达：没有 status=active 且 email_verified 的运营账号。` +
          "请在运营台「运营账号」里补齐并验证邮箱，否则待办通知永远发不出去。",
      );
    }
    return alerted;
  }
}
