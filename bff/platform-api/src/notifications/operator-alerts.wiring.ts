/**
 * operator-alerts.wiring.ts — 运营待办告警的装配与文案（#231，owner 2026-09-08 定档）。
 * @package @vxture/bff-platform-api
 *
 * owner 定的四条：**只发邮件**、**4h 静默窗口**、推「客户已申报付款」与「已收款未开通」
 * 两类待办、外加「自愈放弃」独立一条且级别更高。「部分收款尾款挂账」不推——那一类在
 * 等客户，不在等运营。站内暂时给不了运营（inbox_messages 是租户表），短信不做。
 * 2026-09-28 根治批加第三类待办「退款审核」：此前退款单挂着无人知（RFD-202609-4E7BD7BEC1）。
 *
 * 待办本身不在这里算：OpsTodoAlertJob 从 `@vxture/service-ops-todos` 取（admin 待办页读的
 * 同一份），这里只把一条待办翻成一封邮件。四条告警的文案都在这里，好让它们读起来是一套。
 * 收件人解析、去重、账本在 OperatorAlertDispatcher（@vxture/service-notification）。
 *
 * 静默窗口的去重键 = code + reference(type, id)。待办接口只出可视码，所以 reference.id 是
 * order_no / refund_no（此前是订单 uuid）；切换后首轮可能对 4h 内已告警过的单再发一次，
 * 一次性代价，接受。
 *
 * **维护窗口那一类是例外**：它的称呼是运营自己填的窗口标题，不唯一（title 上没有唯一约束）
 * 也不短（varchar(256)，而 notification_logs.reference_id 是 varchar(128)）。拿标题当键
 * 有两种坏法，都不报错：超 128 是 22001——账本写不进去，下一轮去重失效、每 tick 重发；
 * 两个前缀相同的长标题截断后撞成一条——后一个窗口的告警被前一个的静默窗口吞掉。
 * 所以那一类的键取待办自己的身份（`todo.id`，即窗口主键，见 service-ops-todos 的
 * MAINTENANCE_TODOS_HEAD），再经 `opsNoticeReferenceId` 收口到 128——与通告侧同一个助手。
 * 这个键只进台账，一个字都不上屏。
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
} from "@vxture/service-subscription";
import type { OpsTodo } from "@vxture/service-ops-todos";
import {
  PgNoticeRepository,
  type CreateSystemNoticeInput,
} from "@vxture/service-notice";
import {
  OPS_NOTICE_INFO_TTL_MS,
  OPS_SIGNAL_REFERENCE_TYPE,
  opsNoticeReferenceId,
  redactUuids,
  resolveOpsNoticeTenant,
  writeOpsNotice,
  type SystemNoticeWriter,
} from "./ops-notice";

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

/**
 * 一条待办 → 一封邮件的素材。纯函数，导出为可测。
 * 两类订单的主题 / 行沿用 #231 原文；退款审核那条按 2026-09-28 契约加；
 * 余下六条是 2026-09-28 第三批（ALERT_KINDS 从三类扩到九类）。
 * 不在 ALERT_KINDS 里的类别直接抛——作业只会传裁定过要告警的那几类，传了别的说明接线错了，
 * 静默跳过会把「没发」藏起来（#231 的病根正是这种坏法）。
 * `check-ops-todo-alerts` 第 6 段反过来钉住：裁定要告警的每一类在这里都有一个分支。
 */
export function todoAlertInput(
  todo: OpsTodo,
  opts: { link: string | undefined; now?: Date },
): OperatorAlertInput {
  const waited = humanizeWaiting(new Date(todo.waitingSince), opts.now);
  const amount = money(
    Number(todo.amount?.value ?? 0),
    todo.amount?.currency ?? "CNY",
  );
  const tenantName = todo.tenant?.name?.trim() || "（租户已删除）";
  const no = todo.subject.no;
  switch (todo.kind) {
    case "confirm_payment":
      return {
        code: "ops.order.pending_verify",
        reference: { type: "order", id: no },
        subject: `${no} 客户已申报付款，待确认收款（已等 ${waited}）`,
        lines: [
          `${tenantName} 申报已完成支付，金额 ${amount}，等待运营核对到账。`,
          `订单 ${no}，已等待 ${waited}。`,
          "核对到账后在订单详情页「确认收款」（确认即自动开通），或驳回申报。",
        ],
        link: opts.link,
      };
    case "reprovision":
      return {
        code: "ops.order.paid_unprovisioned",
        reference: { type: "order", id: no },
        subject: `${no} 已收款但权益未开通（已等 ${waited}）`,
        lines: [
          `${tenantName} 的账单已结清，金额 ${amount}，但开通没有落地。`,
          `订单 ${no}，已等待 ${waited}。`,
          "系统会自动重试开通；若长时间不变，请在订单详情页「重试开通」。",
        ],
        link: opts.link,
      };
    case "refund_audit": {
      const product = todo.product
        ? `（${[todo.product.name, todo.product.planName].filter(Boolean).join(" ")}）`
        : "";
      return {
        code: "ops.refund.pending_audit",
        reference: { type: "refund", id: no },
        subject: `${no} 客户申请退款，待审核（已等 ${waited}）`,
        lines: [
          `${tenantName} 申请退款 ${amount}${product}，等待运营审核。`,
          `退款单 ${no}，已等待 ${waited}。`,
          "在订单详情页「审核退款」：通过后执行退款，或驳回并写明原因。",
        ],
        link: opts.link,
      };
    }
    case "refund_execute":
      return {
        code: "ops.refund.pending_execute",
        reference: { type: "refund", id: no },
        subject: `${no} 退款已审核通过，钱还没退出去（已等 ${waited}）`,
        lines: [
          `${tenantName} 的退款 ${amount} 已审核通过，但退款还没执行。`,
          `退款单 ${no}，自审核通过起已等待 ${waited}。`,
          "客户这边已经收到「退款申请已通过」，钱不到账就是我们欠着。" +
            "在订单详情页「执行退款」。",
        ],
        link: opts.link,
      };
    case "refund_processing_stuck":
      return {
        code: "ops.refund.processing_stuck",
        reference: { type: "refund", id: no },
        subject: `${no} 退款卡在处理中（已 ${waited}）`,
        lines: [
          `${tenantName} 的退款 ${amount} 处于「处理中」已 ${waited}，没有落终态。`,
          `退款单 ${no}。线下对公退款要人去银行确认到账，没有回调会替我们收尾。`,
          "先确认这笔钱到底出去了没有，再在订单详情页把它落成成功或失败——" +
            "停在处理中的单，客户那边看到的是「正在退款」。",
        ],
        link: opts.link,
      };
    case "refund_failed":
      return {
        code: "ops.refund.failed",
        reference: { type: "refund", id: no },
        subject: `${no} 退款失败，客户的钱没回去（已 ${waited}）`,
        lines: [
          `${tenantName} 的退款 ${amount} 执行失败，已 ${waited} 没有处置。`,
          `退款单 ${no}。失败不会自己重试：钱还在我们这里，客户在等。`,
          "在订单详情页看失败原因（收款账户 / 金额 / 渠道），改对之后重新执行。",
        ],
        link: opts.link,
      };
    case "addon_pending_confirm":
      return {
        code: "ops.addon.pending_confirm",
        reference: { type: "addon_order", id: no },
        subject: `${no} 加油包待核销（已等 ${waited}）`,
        lines: [
          `${tenantName} 的加油包订单 ${amount}${
            todo.product ? `（${todo.product.name}）` : ""
          }在等运营核销。`,
          `加油包单 ${no}，已等待 ${waited}。`,
          "核对到账后在「加油包订单」里确认收款——确认即刻授予配额，不确认客户就一直没有额度。",
        ],
        link: opts.link,
      };
    case "ticket_sla":
      return {
        code: "ops.ticket.first_response_overdue",
        reference: { type: "ticket", id: no },
        subject: `${no} 工单首次响应已超时（已等 ${waited}）`,
        lines: [
          `${tenantName} 的工单${
            todo.ticket ? `「${todo.ticket.title}」` : ""
          }建单 ${waited} 还没有任何回复${
            todo.ticket ? `（优先级 ${todo.ticket.priority}）` : ""
          }。`,
          `工单 ${no}。首次响应时限按优先级算：p0 1 小时 / p1 4 小时 / p2 24 小时 / p3 72 小时。`,
          "先回一句「已收到、正在看」也算响应——客户等的是有人接手，不是一步到位的答案。",
        ],
        link: opts.link,
      };
    case "maintenance_overdue": {
      /*
       * 这一支的主体码是**运营在运维台自己填的一段自由文本**（窗口标题），别的类别都是
       * 我们自己发的号。于是它比别的分支多两道处理，两道都不是可选的：
       *
       * ① 上屏的那一份过 `redactUuids`。邮件也是人在读，与通告那半
       *    （composeEscalatedTodoNotice）同一条铁律；把一个内部 id 粘进窗口标题是常事，
       *    抹不掉就是一串谁也查不了的十六进制发到运营邮箱。
       * ② 去重键**不拿标题**，取待办自己的身份（见文件头注那一段）。`opsNoticeReferenceId`
       *    与通告侧同一个助手：128 以内原样、超长截断并缀内容哈希，所以两件事不会撞成一条。
       */
      const title = redactUuids(no);
      return {
        code: "ops.maintenance.window_overdue",
        reference: {
          type: "maintenance_window",
          id: opsNoticeReferenceId(todo.id),
        },
        subject: `维护窗口已超过计划结束时间 ${waited}：${title}`,
        lines: [
          `维护窗口「${title}」的计划结束时间已过 ${waited}，状态还是「进行中」。`,
          "窗口不收，挂在它上面的产品就一直显示维护中——客户看到的是产品坏了，不是在维护。",
          "在运维台「维护窗口」里结束维护，或把结束时间改到真实的收工时刻。",
        ],
        link: opts.link,
      };
    }
    default:
      throw new Error(
        `待办类别 ${todo.kind} 没有告警裁定（见 scripts/guardrails/check-ops-todo-alerts.mjs）`,
      );
  }
}

/* ── 两条已有邮件告警，各再加一条运营通告（2026-09-28 第二批 C-4 / C-5）────────── */

/**
 * 停了会直接卡住客户的作业。这三条的异常不只是运维的事，所以通告**同时投 admin**：
 *   · subscription-renewal   —— 续费单不开，客户到期即停
 *   · order-payment-expiry   —— 超时单不关，客户的单一直挂着（券也不释放）
 *   · provisioning-dispatch  —— 已收款的权益不落地
 * 其余作业（用量归集 / 池补充 / 清扫类）坏了先是运维的事，只投 opera。
 * 名字与各作业文件里的 JOB_NAME 逐字一致——它就是 provisioning.background_jobs 的主键。
 */
export const CUSTOMER_BLOCKING_JOBS: ReadonlySet<string> = new Set([
  "subscription-renewal",
  "order-payment-expiry",
  "provisioning-dispatch",
]);

export interface JobHealthNoticeFacts {
  readonly verdict: "failed" | "stalled";
  readonly jobName: string;
  readonly idleMs: number;
  readonly thresholdMs: number;
  readonly intervalMs: number | null;
  readonly lastError: string | null;
  readonly failureCount: number;
  /**
   * 心跳里的 last_started_at —— 去重键就靠它分「一次episode」。
   * 静默时它是冻住的（所以整段静默只播一条）；失败时每一轮都会推进（所以每一轮失败各播一条，
   * 这正是要的：连续失败的次数本身是信息）。从没跑过（null）则按当天收敛。
   */
  readonly lastStartedAt: Date | null;
  readonly now?: Date;
}

/**
 * 纯函数：作业健康裁定 → 一条待写的通告。
 *
 * 静默 = critical（作业死了什么都不留，是真盲区），失败 = warning（下一轮会重试）。
 * 静默那条不过期——它一直是真的，直到有人让作业跑起来；失败那条 30 天后退出列表。
 *
 * 链接：`/ops/jobs` 只在 opera 里存在。planes 含 admin 时**不给链接**——通告的 link 是
 * 平面内相对路径，各平面各自解析，给了就是一个在 admin 里点开 404 的链接。
 */
export function composeJobHealthNotice(
  facts: JobHealthNoticeFacts,
): CreateSystemNoticeInput {
  const now = facts.now ?? new Date();
  const idle = humanizeWaiting(new Date(now.getTime() - facts.idleMs), now);
  const stalled = facts.verdict === "stalled";
  const blocking = CUSTOMER_BLOCKING_JOBS.has(facts.jobName);
  const planes: ("admin" | "opera")[] = blocking
    ? ["opera", "admin"]
    : ["opera"];
  const heartbeat = facts.intervalMs
    ? `${Math.round(facts.intervalMs / 1000)} 秒`
    : "未记录";
  const lines = stalled
    ? [
        `作业 ${facts.jobName} 距上次开跑已 ${idle}，超过 ${Math.round(facts.thresholdMs / 60000)} 分钟阈值（心跳间隔 ${heartbeat}）。`,
        "两种可能：调度没起来（进程 / 注册），或卡在某一轮出不来。两种都不会留下失败记录。",
        "先在 opera 的任务调度看这一行的最后状态，再查 platform-api 容器日志。",
      ]
    : [
        `作业 ${facts.jobName} 最近一轮执行失败，累计失败 ${facts.failureCount} 次。`,
        /* 心跳里的错误原文是外来的字：作业抛什么就存什么，里面常带 uuid
           （「订阅 xxx 不存在」、pg 把整行冲突键值打出来）。先抹再截，见 redactUuids。 */
        facts.lastError
          ? `错误：${redactUuids(facts.lastError).slice(0, 800)}`
          : "（心跳里没有留下错误文本。）",
        "一轮失败不会让作业停摆，下一轮会重试；连续失败才需要人介入。",
      ];
  if (blocking) {
    lines.push(
      "这条作业停着客户会直接受影响（续费单不开 / 超时单不关 / 已收款的开通不落地），" +
        "所以运营台也收到了同一条。",
    );
  }
  return {
    targetPlanes: planes,
    severity: stalled ? "critical" : "warning",
    title: (stalled
      ? `后台作业静默：${facts.jobName}（已 ${idle} 未开跑）`
      : `后台作业执行失败：${facts.jobName}（累计失败 ${facts.failureCount} 次）`
    ).slice(0, 256),
    body: lines.join("\n"),
    link: planes.length === 1 ? "/ops/jobs" : null,
    referenceType: OPS_SIGNAL_REFERENCE_TYPE,
    /*
     * 一个 episode 一条：键带 last_started_at。作业名是库主键（varchar(64)），
     * 加上前缀与 ISO 时刻远低于 reference_id 的 128 列宽。
     * 从没跑过的作业没有时刻可用，按当天收敛——否则「never」会变成这辈子只播一条。
     */
    referenceId: `job_${facts.verdict}:${facts.jobName}:${
      facts.lastStartedAt
        ? facts.lastStartedAt.toISOString()
        : `never:${now.toISOString().slice(0, 10)}`
    }`,
    expiresAt: stalled
      ? null
      : new Date(now.getTime() + OPS_NOTICE_INFO_TTL_MS),
  };
}

/**
 * 纯函数：自愈放弃 → 一条 critical 通告。只投 admin：出路在订单详情页
 * （重试开通 / 看订单事件），而那一页只有 admin 有，所以链接给得出来。
 *
 * 去重键带 attempts（= 放弃点的失败次数）。放弃状态是持续的，这条分支每 tick 都会走到，
 * 进程重启后计数归零重来也仍然撞到同一个键——一单一条，不刷屏。不过期：钱已经收了、
 * 权益没开通，这件事不会自己变好。
 */
export function composeSelfHealGaveUpNotice(facts: {
  readonly orderNo: string;
  readonly attempts: number;
  readonly lastError: string | null;
}): CreateSystemNoticeInput {
  return {
    targetPlanes: ["admin"],
    severity: "critical",
    title:
      `自动开通已放弃重试：${facts.orderNo}（失败 ${facts.attempts} 次）`.slice(
        0,
        256,
      ),
    body: [
      `订单 ${facts.orderNo} 已收款但开通失败 ${facts.attempts} 次，自动重试已停止。`,
      "这单不会再自愈，必须人工介入：在订单详情页重试开通，失败则查看订单事件。",
      facts.lastError
        ? // 开通失败的原文最常带 uuid（订阅 id、provisioning 的 request id）。
          `最后一次失败原因：${redactUuids(facts.lastError).slice(0, 500)}`
        : "（本进程内没有留下失败原因，多半是重启后重新计数到上限。）",
    ].join("\n"),
    link: `/orders/${encodeURIComponent(facts.orderNo)}`,
    referenceType: OPS_SIGNAL_REFERENCE_TYPE,
    referenceId: `selfheal_gave_up:${facts.orderNo}:${facts.attempts}`,
    expiresAt: null,
  };
}

/**
 * 纯函数：一条**升档**的待办 → 一条 critical 运营通告（2026-09-28 第三批）。
 *
 * 为什么邮件之外还要这一条：邮件有 4h 静默窗口，而且漏看就没了。升档的意思是
 * 「这件事已经超过它该被处理的时限」——那正是最不该只靠一封可能被漏看的邮件承载的一类。
 * 通告留在运营台的列表里直到有人读它。
 *
 * 去重键 = `{待办身份}:{升档级数}`（`todo.id` 已经是 `{类别}:{身份}`，十九类里的十八类
 * 身份就是可视码，读库的人一眼看得懂是哪件事）。级数就是「等待 / 阈值」的整数倍，所以
 * **每跨过一个阈值周期播一条**：拖 4 小时一条、拖 8 小时再一条。一件事拖得越久，
 * 台面上挂着的 critical 越多，而不是同一条被静默窗口吞掉（#231 的病根）。
 * 只投 admin：出路（确认收款 / 审核退款 / 重试开通 / 看认证）都在运营台那几页上。
 *
 * 不过期：与自愈放弃同一条判断——它不会自己变好。
 *
 * 链接可以没有（`href` 为 null 的类别在 admin 里没有对应页面），那时不给 link，
 * 正文里说清去哪儿办。
 */
export function composeEscalatedTodoNotice(
  todo: OpsTodo,
): CreateSystemNoticeInput {
  const waited = humanizeWaiting(new Date(todo.waitingSince));
  const tenantName = todo.tenant?.name?.trim() ?? "";
  const amount = todo.amount
    ? money(Number(todo.amount.value), todo.amount.currency)
    : null;
  const subjectLabel = TODO_SUBJECT_LABELS[todo.subject.type] ?? "待办";
  const lines = [
    `${subjectLabel} ${todo.subject.no}${tenantName ? `（${tenantName}）` : ""}` +
      `已等待 ${waited}，超过这一类的处理时限${
        todo.escalationStep > 1 ? ` ${todo.escalationStep} 倍` : ""
      }。`,
    amount ? `涉及金额 ${amount}。` : null,
    todo.href
      ? "点开这条通告直接去处置页。"
      : `处置面不在运营台：${MAINTENANCE_ELSEWHERE}`,
    "这一条不会自己消失——待办处置掉之前，每多拖一个时限周期就会再来一条。",
  ].filter((line): line is string => line !== null);
  return {
    targetPlanes: ["admin"],
    severity: "critical",
    title:
      `待办已超时：${subjectLabel} ${todo.subject.no}（已等 ${waited}）`.slice(
        0,
        256,
      ),
    /* 正文里的可视码、租户名、金额都是我们自己写的字，不带 uuid；
       但主体码里可能混进外来文本（维护窗口标题是人填的），同一条铁律过一遍。 */
    body: redactUuids(lines.join("\n")),
    link: todo.href,
    referenceType: OPS_SIGNAL_REFERENCE_TYPE,
    referenceId: opsNoticeReferenceId(`${todo.id}:${todo.escalationStep}`),
    expiresAt: null,
  };
}

/** 通告标题里怎么称呼这条待办的宾语。缺省回落「待办」，不硬编码一个可能错的词。 */
const TODO_SUBJECT_LABELS: Readonly<Record<string, string>> = {
  order: "订单",
  refund: "退款单",
  subscription: "订阅",
  invoice: "发票申请",
  addon: "加油包单",
  tenant: "租户",
  user: "账号",
  ticket: "工单",
  maintenance: "维护窗口",
};

/** 只有维护窗口这一类的出路在别的平面上；文案在这里成一处，两个地方都引它。 */
const MAINTENANCE_ELSEWHERE = "去运维台的「维护窗口」处理。";

@Injectable()
export class OperatorAlertsWiring implements OnModuleInit, OpsAlerter {
  private readonly logger = new Logger(OperatorAlertsWiring.name);
  private readonly dispatcher: OperatorAlertDispatcher;
  /** 运营台（admin）绝对前缀；没配就不给链接（邮件里放相对路径没意义）。 */
  private readonly adminBaseUrl: string | null;
  /** 运维台（opera）绝对前缀，作业健康告警的深链用。 */
  private readonly operaBaseUrl: string | null;
  /**
   * 通告写侧（2026-09-28 第二批）。懒建：手上的 COMMERCE_PG_POOL 与 NoticeModule 自带的
   * 池令牌是两回事（同名 token 在一个容器里会静默互相覆盖），库是同一个，直接用这只池
   * ——与 services/notification/dispatch 里 new PgNoticeRepository(pool) 同一手法。
   */
  private noticeWriter: SystemNoticeWriter | null = null;

  constructor(
    @Inject(COMMERCE_PG_POOL) private readonly pool: Pool,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {
    this.adminBaseUrl = process.env.ADMIN_BASE_URL?.replace(/\/$/, "") ?? null;
    this.operaBaseUrl = process.env.OPERA_BASE_URL?.replace(/\/$/, "") ?? null;
    this.dispatcher = new OperatorAlertDispatcher(this.pool, {
      mail: new MailService(),
      logger: this.logger,
    });
  }

  private notices(): SystemNoticeWriter {
    if (!this.noticeWriter) {
      this.noticeWriter = new PgNoticeRepository(this.pool);
    }
    return this.noticeWriter;
  }

  onModuleInit(): void {
    this.orders.setOpsAlerter(this);
    /*
     * 自动续费的两条信号（开单失败 / 无同周期价目）由订阅服务自己报——它们在库里不留行，
     * 只有那一轮的代码知道。订阅包碰不到 tenancy，所以「谁的订阅」这一步在这里解析
     * （通告里不许出现 UUID）。与 setOpsAlerter 同一手法：跨模块 DI 令牌在那边看不见。
     */
    this.orders.setOpsNoticePort({
      createSystemNotice: (input) => this.notices().createSystemNotice(input),
      resolveTenantIdentity: (tenantId) =>
        resolveOpsNoticeTenant(this.pool, tenantId, this.logger),
    });
    const missing = [
      this.adminBaseUrl ? null : "ADMIN_BASE_URL",
      this.operaBaseUrl ? null : "OPERA_BASE_URL",
    ].filter(Boolean);
    this.logger.log(
      `operator alerts wired (email only)${missing.length ? ` — 未配 ${missing.join(" / ")}，相应告警邮件不带链接` : ""}`,
    );
  }

  private orderLink(orderNo: string): string | undefined {
    if (!this.adminBaseUrl) return undefined;
    return `${this.adminBaseUrl}/orders/${encodeURIComponent(orderNo)}`;
  }

  /** opera 的「任务调度」页——作业心跳就在那一页。 */
  private jobsLink(): string | undefined {
    if (!this.operaBaseUrl) return undefined;
    return `${this.operaBaseUrl}/ops/jobs`;
  }

  /**
   * 待办接口给的是 admin 内相对路径；邮件里要绝对链接，没配前缀就不给。
   * `href` 为 null 的类别（maintenance_overdue）在 admin 里没有页面——那时也不给链接，
   * 邮件正文自己说清去哪儿办（见 todoAlertInput 那一支）。
   */
  private adminLink(href: string | null): string | undefined {
    if (!href || !this.adminBaseUrl) return undefined;
    return `${this.adminBaseUrl}${href}`;
  }

  /**
   * 九类待办（见 ops-todo-alert.job 的 ALERT_KINDS）→ 各一封邮件。
   * 升档的那些**另外**写一条 critical 运营通告：邮件有 4h 静默窗口、漏看就没了，
   * 通告留在列表里。通告先写、写失败不影响邮件（writeOpsNotice 永不抛）。
   *
   * 「升档 → 通告」这半只对**走到这里**的类别成立，也就是 ALERT_KINDS 那九类。
   * 四个有升档阈值的类别里，`verification` 不在 ALERT_KINDS（owner 未裁定，且它那一段
   * SQL 碰的 schema 在本进程角色的授权面之外），所以它只有页面上的「已超时」标记、
   * 没有通告——见 service-ops-todos 的 `OpsTodo.escalated` 注释。
   */
  async alertTodo(todo: OpsTodo): Promise<OperatorAlertResult> {
    if (todo.escalated) {
      await writeOpsNotice(
        this.notices(),
        composeEscalatedTodoNotice(todo),
        this.logger,
        `todo_escalated ${todo.kind} ${todo.subject.no} step ${todo.escalationStep}`,
      );
    }
    return this.alert(
      todoAlertInput(todo, { link: this.adminLink(todo.href) }),
    );
  }

  /**
   * 自愈放弃：级别更高——自愈都不试了，说明这单靠系统自己好不了。
   *
   * 邮件照旧（4h 静默窗口在 dispatcher 里），另加一条 critical 通告：邮件漏看就没了，
   * 通告留在运营台的列表里直到有人读它。通告先写、且失败不影响邮件（见 writeOpsNotice）。
   */
  async orderSelfHealGaveUp(
    input: OpsSelfHealGaveUpInput,
  ): Promise<OperatorAlertResult> {
    await writeOpsNotice(
      this.notices(),
      composeSelfHealGaveUpNotice({
        orderNo: input.orderNo,
        attempts: input.attempts,
        lastError: input.lastError,
      }),
      this.logger,
      `selfheal_gave_up ${input.orderNo}`,
    );
    return this.alert({
      code: "ops.order.selfheal_gave_up",
      reference: { type: "order", id: input.orderId },
      subject: `${input.orderNo} 自动开通已放弃重试，需人工处理`,
      lines: [
        `订单 ${input.orderNo} 已收款但开通失败 ${input.attempts} 次，自动重试已停止。`,
        "这单不会再自愈，必须人工介入：在订单详情页「重试开通」，失败则查看订单事件。",
        input.lastError
          ? // 邮件也是人在读，同一条铁律（通告那半在 composeSelfHealGaveUpNotice）。
            `最后一次失败原因：${redactUuids(input.lastError).slice(0, 500)}`
          : "（本进程内没有留下失败原因，多半是重启后重新计数到上限。）",
      ],
      link: this.orderLink(input.orderNo),
    });
  }

  /**
   * 后台作业健康（opera 平面，owner 2026-09-08 定「失败 + 静默」)。
   * 静默那条把「多久没动」和阈值都写进正文——不然收信人无从判断这是真死了还是刚好慢。
   */
  async alertJobHealth(input: {
    verdict: "failed" | "stalled";
    jobName: string;
    idleMs: number;
    thresholdMs: number;
    intervalMs: number | null;
    lastError: string | null;
    failureCount: number;
    /** 心跳的 last_started_at：通告的去重键靠它分 episode（邮件侧不用）。 */
    lastStartedAt: Date | null;
  }): Promise<OperatorAlertResult> {
    // 邮件之外再写一条通告（2026-09-28）：邮件有 4h 静默窗口且漏看就没了，
    // 通告留在列表里。写失败不影响邮件——这一段永不抛。
    await writeOpsNotice(
      this.notices(),
      composeJobHealthNotice({
        verdict: input.verdict,
        jobName: input.jobName,
        idleMs: input.idleMs,
        thresholdMs: input.thresholdMs,
        intervalMs: input.intervalMs,
        lastError: input.lastError,
        failureCount: input.failureCount,
        lastStartedAt: input.lastStartedAt,
      }),
      this.logger,
      `job_${input.verdict} ${input.jobName}`,
    );
    const idle = humanizeWaiting(new Date(Date.now() - input.idleMs));
    if (input.verdict === "stalled") {
      return this.alert({
        code: "ops.job.stalled",
        reference: { type: "job", id: input.jobName },
        subject: `后台作业 ${input.jobName} 已静默 ${idle}`,
        lines: [
          `作业 ${input.jobName} 距上次开跑已 ${idle}，超过 ${Math.round(input.thresholdMs / 60000)} 分钟阈值` +
            `（心跳间隔 ${input.intervalMs ? Math.round(input.intervalMs / 1000) + " 秒" : "未记录"}）。`,
          "两种可能:调度没起来(进程/注册)，或卡在某一轮出不来。两种都不会留下失败记录。",
          "先在 opera「任务调度」看这一行的最后状态，再查 platform-api 容器日志。",
        ],
        link: this.jobsLink(),
      });
    }
    return this.alert({
      code: "ops.job.failed",
      reference: { type: "job", id: input.jobName },
      subject: `后台作业 ${input.jobName} 上次执行失败`,
      lines: [
        `作业 ${input.jobName} 最近一轮执行失败，累计失败 ${input.failureCount} 次。`,
        input.lastError
          ? // 同上：邮件正文也不许带 uuid（通告那半在 composeJobHealthNotice）。
            `错误：${redactUuids(input.lastError).slice(0, 800)}`
          : "（心跳里没有留下错误文本。）",
        "作业本身不会因为一轮失败停摆,下一轮会重试;连续失败才需要人介入。",
      ],
      link: this.jobsLink(),
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
