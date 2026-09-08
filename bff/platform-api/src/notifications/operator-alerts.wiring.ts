/**
 * operator-alerts.wiring.ts — 运营待办告警的装配与文案（#231，owner 2026-09-08 定档）。
 * @package @vxture/bff-platform-api
 *
 * owner 定的四条：**只发邮件**、**4h 静默窗口**、推「客户已申报付款」与「已收款未开通」
 * 两类待办、外加「自愈放弃」独立一条且级别更高。「部分收款尾款挂账」不推——那一类在
 * 等客户，不在等运营。站内暂时给不了运营（inbox_messages 是租户表），短信不做。
 *
 * 三条告警的文案都在这里，好让它们读起来是一套。收件人解析、去重、账本在
 * OperatorAlertDispatcher（@vxture/service-notification）。
 *
 * 自愈放弃走 setOpsAlerter 注入，与 [[customer-notifications.wiring]] 同一手法：
 * SubscriptionModule 自包含，跨模块 DI 令牌不可见，只能在装配处按接口挂。
 */
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Pool } from "pg";
import { MailService } from "@vxture/core-mail";
import {
  OperatorAlertDispatcher,
  type OperatorAlertInput,
  type OperatorAlertResult,
} from "@vxture/service-notification";
import {
  COMMERCE_PG_POOL,
  OrderService,
  type OpsAlerter,
  type OpsSelfHealGaveUpInput,
  type OpsTodoOrderRow,
} from "@vxture/service-subscription";

/** 「已等待 3 小时 12 分钟」——运营看的是等了多久，不是时间戳。 */
export function humanizeWaiting(since: Date, now = new Date()): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - since.getTime()) / 60000),
  );
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24)
    return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
  const days = Math.floor(hours / 24);
  return `${days} 天 ${hours % 24} 小时`;
}

function money(amount: number, currency: string): string {
  const symbol = currency === "CNY" ? "¥" : `${currency} `;
  return `${symbol}${amount.toFixed(2)}`;
}

@Injectable()
export class OperatorAlertsWiring implements OnModuleInit, OpsAlerter {
  private readonly logger = new Logger(OperatorAlertsWiring.name);
  private readonly dispatcher: OperatorAlertDispatcher;
  /** 运营台绝对前缀；没配就不给链接（邮件里放相对路径没意义）。 */
  private readonly adminBaseUrl: string | null;

  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {
    this.adminBaseUrl = process.env.ADMIN_BASE_URL?.replace(/\/$/, "") ?? null;
    this.dispatcher = new OperatorAlertDispatcher(this.pool, {
      mail: new MailService(),
      logger: this.logger,
    });
  }

  onModuleInit(): void {
    this.orders.setOpsAlerter(this);
    this.logger.log(
      `operator alerts wired (email only${this.adminBaseUrl ? ", links → " + this.adminBaseUrl : ", no ADMIN_BASE_URL → 邮件不带链接"})`,
    );
  }

  private orderLink(orderNo: string): string | undefined {
    if (!this.adminBaseUrl) return undefined;
    return `${this.adminBaseUrl}/orders/${encodeURIComponent(orderNo)}`;
  }

  /** 两类订单态待办。文案按类分，处理动作说清楚在哪一页做什么。 */
  async alertOrderTodo(row: OpsTodoOrderRow): Promise<OperatorAlertResult> {
    const waited = humanizeWaiting(row.waitingSince);
    const amount = money(row.payableAmount, row.currency);
    const input: OperatorAlertInput =
      row.status === "pending_verify"
        ? {
            code: "ops.order.pending_verify",
            reference: { type: "order", id: row.id },
            subject: `${row.orderNo} 客户已申报付款，待确认收款（已等 ${waited}）`,
            lines: [
              `${row.tenantName} 申报已完成支付，金额 ${amount}，等待运营核对到账。`,
              `订单 ${row.orderNo}，已等待 ${waited}。`,
              "核对到账后在订单详情页「确认收款」（确认即自动开通），或驳回申报。",
            ],
            link: this.orderLink(row.orderNo),
          }
        : {
            code: "ops.order.paid_unprovisioned",
            reference: { type: "order", id: row.id },
            subject: `${row.orderNo} 已收款但权益未开通（已等 ${waited}）`,
            lines: [
              `${row.tenantName} 的账单已结清，金额 ${amount}，但开通没有落地。`,
              `订单 ${row.orderNo}，已等待 ${waited}。`,
              "系统会自动重试开通；若长时间不变，请在订单详情页「重试开通」。",
            ],
            link: this.orderLink(row.orderNo),
          };
    return this.alert(input);
  }

  /** 自愈放弃：级别更高——自愈都不试了，说明这单靠系统自己好不了。 */
  async orderSelfHealGaveUp(
    input: OpsSelfHealGaveUpInput,
  ): Promise<OperatorAlertResult> {
    return this.alert({
      code: "ops.order.selfheal_gave_up",
      reference: { type: "order", id: input.orderId },
      subject: `${input.orderNo} 自动开通已放弃重试，需人工处理`,
      lines: [
        `订单 ${input.orderNo} 已收款但开通失败 ${input.attempts} 次，自动重试已停止。`,
        "这单不会再自愈，必须人工介入：在订单详情页「重试开通」，失败则查看订单事件。",
        input.lastError
          ? `最后一次失败原因：${input.lastError.slice(0, 500)}`
          : "（本进程内没有留下失败原因，多半是重启后重新计数到上限。）",
      ],
      link: this.orderLink(input.orderNo),
    });
  }

  /**
   * 统一出口：把「该发却没人可发」这件事顶到 error 级。
   * 这正是 #231 要补的盲区——有待办、没人收到，静默地什么都不发生。
   */
  private async alert(input: OperatorAlertInput): Promise<OperatorAlertResult> {
    const result = await this.dispatcher.alert(input);
    if (result.noRecipient) {
      this.logger.error(
        `${input.code}（${input.reference.id}）无人可达：` +
          "没有任何 status=active 且 email_verified 的运营账号，告警没有送出去。",
      );
    }
    return result;
  }
}
