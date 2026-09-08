/**
 * operator-alerts.ts — 运营待办告警（#231，owner 2026-09-08 定档）。
 * @package @vxture/service-notification
 *
 * ── 为什么不复用 NotificationDispatcher ──
 * 那条是**客户**通路，形状上就装不下运营：收件人经 `tenancy.tenants.owner_user_id`
 * 解析、邮箱查 `account.users`、偏好读 `account.user_profiles`，而且**站内落库是前置**
 * ——`support.inbox_messages.tenant_id` 是 NOT NULL，插不进去就整条跳过，邮件根本不会发。
 * 运营账号在 `admin.operator_account`，没有租户、没有 inbox 行、没有偏好行。
 * 所以运营侧另起一条最小通路：只走邮件，只复用 MailService 与 notification_logs。
 * （站内要给运营开，得先让 inbox_messages 支持非租户维度——那是另一件事，见 #231。）
 *
 * ── 去重与静默窗口 ──
 * 待办是**持续状态**不是一次性事件：一张单卡在「已收款未开通」会一直卡着。
 * 出现即推一次 → 漏看就再也不提醒（2026-09-08 事故正是这样，靠客户反馈才发现）；
 * 每次巡检都推 → 60 秒一封，必然被无视。owner 定：**首推 + 4h 静默 + 超窗未处理再推**。
 *
 * 去重依据直接用 `support.notification_logs`——它本来就是投递台账，不另建表：
 *   · 4h 内有过**成功**投递 → 跳过（有人收到了）
 *   · 15min 内有过**失败**尝试 → 跳过（SMTP 在坏，退避，别每 tick 写一行脏账本）
 * 判据按 (template_code, reference_type, reference_id, channel) 聚合取两个 max，
 * 不按「最近一行」——多个收件人一成一败时，最近一行是谁纯看时序，会误判。
 *
 * ── 收件人 ──
 * `status='active'` 且 `email_verified` 的运营账号。verified 这一条不是我加的偏好：
 * 80_admin.sql 的列注写明带外投递只发验证过的目标（TD-017 §③）。
 * 运营账号没有语言列，文案固定 zh-CN。
 */
import type { Pool } from "pg";
import type { MailSender, NotifyLogger } from "./dispatcher";
import { escapeHtml } from "./templates";

/**
 * 运营告警的模板码。**刻意不并入 `NotificationTemplateCode`**——那个联合是客户模板集，
 * `topicOf` 对它穷尽映射到客户偏好主题；运营告警没有、也不该有客户偏好主题。
 * 两者共用 notification_logs.template_code 这一列（varchar，无枚举约束），`ops.` 前缀区分。
 */
export type OperatorAlertCode =
  // 运营平面（admin）：订单待办
  | "ops.order.pending_verify"
  | "ops.order.paid_unprovisioned"
  | "ops.order.selfheal_gave_up"
  // 运维平面（opera）：后台作业健康
  | "ops.job.failed"
  | "ops.job.stalled";

/**
 * 运营告警的业务引用类型。**同样不复用 `NotificationReferenceType`**——那个联合是
 * 客户通知的引用域（subscription / order / refund / announcement），后台作业不属于
 * 其中任何一个，硬塞进去会让客户侧的类型跟着长出运营概念。
 * 落库同一列（varchar(64)，无枚举约束）。
 */
export type OperatorAlertReferenceType = "order" | "job";

/** 成功投递后的静默时长（owner 2026-09-08 定 4 小时）。 */
export const OPS_ALERT_SILENCE_MS = 4 * 60 * 60 * 1000;
/** 投递失败后的退避时长——比静默窗口短得多，SMTP 恢复后要尽快补发。 */
export const OPS_ALERT_RETRY_BACKOFF_MS = 15 * 60 * 1000;

export interface OperatorAlertInput {
  code: OperatorAlertCode;
  reference: { type: OperatorAlertReferenceType; id: string };
  /** 邮件主题（不含前缀，由本类统一加）。 */
  subject: string;
  /** 正文段落，按顺序渲染成 text 的行与 html 的 <p>。 */
  lines: string[];
  /** 目标门户的绝对链接；对应的 *_BASE_URL 没配时由调用方传 undefined。 */
  link?: string | undefined;
}

export interface OperatorAlertOptions {
  mail?: MailSender | null | undefined;
  /** 写进 notification_logs.provider；默认 "smtp"。 */
  provider?: string | undefined;
  logger?: NotifyLogger | undefined;
  /** 覆盖静默窗口（测试用；生产走 OPS_ALERT_SILENCE_MS）。 */
  silenceMs?: number | undefined;
  retryBackoffMs?: number | undefined;
}

/**
 * 静默判定。**从 SQL 里搬出来的纯函数**——判据留在 SQL 里就没法单测：
 * 用假 pool 测时假 pool 会用 JS 重算一遍语义，改坏 SQL 谓词测试照样全绿
 * （2026-09-08 变异测试当场撞到，见 operator-alerts.spec.ts 末尾那条 SQL 断言）。
 *
 * @param lastOk   最近一次**成功**投递时间；无则 null
 * @param lastAny  最近一次投递尝试时间（含失败）；无则 null
 */
export function suppressionOf(
  input: { lastOk: Date | null; lastAny: Date | null },
  windows: { silenceMs: number; retryBackoffMs: number },
  now: number = Date.now(),
): "send" | "silenced" | "backoff" {
  if (input.lastOk && now - input.lastOk.getTime() < windows.silenceMs) {
    return "silenced";
  }
  if (input.lastAny && now - input.lastAny.getTime() < windows.retryBackoffMs) {
    return "backoff";
  }
  return "send";
}

export interface OperatorAlertResult {
  /** 本次实际发出的邮件数。 */
  sent: number;
  failed: number;
  /** true = 命中静默窗口，整条没发。 */
  suppressed: boolean;
  /** true = 该发，但一个可达的运营账号都没有。调用方必须让这件事可见。 */
  noRecipient: boolean;
}

interface OperatorRecipient {
  id: string;
  email: string;
  displayName: string;
}

const SUBJECT_PREFIX = "[Vxture 运营]";

/**
 * 去重查询。导出**只为让 spec 能对谓词本身下断言**——假 pool 不解析 SQL，
 * 光靠行为测试改坏这条谓词是测不出来的。
 * 两个 max 一次取回，不是「取最近一行再看它的状态」：多个收件人一成一败时，
 * 最近一行是谁纯看时序，会把「有人收到了」误判成「刚失败过」。
 */
export const DEDUPE_SQL = `select max(created_at) filter (where status in ('sent','delivered')) as last_ok,
              max(created_at)                                               as last_any
         from support.notification_logs
        where template_code  = $1
          and reference_type = $2
          and reference_id   = $3
          and channel        = 'email'`;

export class OperatorAlertDispatcher {
  private readonly mail: MailSender | null;
  private readonly provider: string;
  private readonly logger: NotifyLogger;
  private readonly silenceMs: number;
  private readonly retryBackoffMs: number;

  constructor(
    private readonly pool: Pool,
    options: OperatorAlertOptions = {},
  ) {
    this.mail = options.mail ?? null;
    this.provider = options.provider ?? "smtp";
    this.silenceMs = options.silenceMs ?? OPS_ALERT_SILENCE_MS;
    this.retryBackoffMs = options.retryBackoffMs ?? OPS_ALERT_RETRY_BACKOFF_MS;
    this.logger = options.logger ?? {
      warn: (m) => console.warn(`[ops-alert] ${m}`),
    };
  }

  async alert(input: OperatorAlertInput): Promise<OperatorAlertResult> {
    const result: OperatorAlertResult = {
      sent: 0,
      failed: 0,
      suppressed: false,
      noRecipient: false,
    };

    // 静默窗口判在**发之前、收件人之前**：命中就整条不发，省掉后面全部查询。
    // 这里不吞异常——查不动说明库坏了，本轮巡检的订单扫描也会一起挂，
    // 让它抛到作业的 try/catch 记成心跳失败，别在这儿装作「没到期」。
    if (await this.suppressed(input)) {
      result.suppressed = true;
      return result;
    }

    const recipients = await this.recipients();
    if (recipients.length === 0) {
      // 有待办、却没有任何可达运营账号——这本身就是运维缺口，调用方负责把它顶到台前。
      result.noRecipient = true;
      return result;
    }

    const body = renderAlert(input);
    for (const to of recipients) {
      if (!this.mail) {
        result.failed += 1;
        await this.log(input, to, "failed", "邮件发送方未注入（SMTP 未配置）");
        continue;
      }
      try {
        await this.mail.send({
          to: to.email,
          subject: body.subject,
          html: body.html,
          text: body.text,
        });
        result.sent += 1;
        await this.log(input, to, "sent");
      } catch (err) {
        const message = String(err instanceof Error ? err.message : err).slice(
          0,
          2000,
        );
        result.failed += 1;
        this.logger.warn(`${input.code} → ${to.email}: 邮件失败 — ${message}`);
        await this.log(input, to, "failed", message);
      }
    }
    return result;
  }

  /** 4h 内成功过、或 15min 内刚失败过 → 本轮不发。 */
  private async suppressed(input: OperatorAlertInput): Promise<boolean> {
    const res = await this.pool.query<{
      last_ok: Date | null;
      last_any: Date | null;
    }>(DEDUPE_SQL, [input.code, input.reference.type, input.reference.id]);
    const row = res.rows[0];
    const decision = suppressionOf(
      { lastOk: row?.last_ok ?? null, lastAny: row?.last_any ?? null },
      { silenceMs: this.silenceMs, retryBackoffMs: this.retryBackoffMs },
    );
    return decision !== "send";
  }

  /** 在用 + 邮箱已验证的运营账号。 */
  private async recipients(): Promise<OperatorRecipient[]> {
    const res = await this.pool.query<{
      id: string;
      email: string | null;
      display_name: string | null;
      username: string;
    }>(
      `select id, email, display_name, username
         from admin.operator_account
        where status = 'active'
          and deleted_at is null
          and email is not null
          and email_verified
        order by username`,
    );
    return res.rows.flatMap((r) => {
      const email = r.email?.trim();
      if (!email) return [];
      return [
        {
          id: r.id,
          email,
          displayName: r.display_name?.trim() || r.username,
        },
      ];
    });
  }

  /**
   * 记账本。tenant_id 留 NULL（运营告警不属于任何租户），account_id 也留 NULL
   * ——那一列指 account.users，运营 id 塞进去会让「按客户查通知」把运营行捞出来。
   * 运营收件人身份记在 recipient（邮箱）上，够审计用。
   */
  private async log(
    input: OperatorAlertInput,
    to: OperatorRecipient,
    status: "sent" | "failed",
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.pool.query(
        `insert into support.notification_logs
           (tenant_id, account_id, channel, template_code, status, reference_type, reference_id,
            recipient, subject, provider, error_message, delivered_at)
         values (null, null, 'email', $1, $2, $3, $4, $5, $6, $7, $8, null)`,
        [
          input.code,
          status,
          input.reference.type,
          input.reference.id,
          to.email.slice(0, 256),
          `${SUBJECT_PREFIX} ${input.subject}`.slice(0, 256),
          this.provider,
          errorMessage ?? null,
        ],
      );
    } catch (err) {
      // 账本写不进去就只剩日志。**不能静默**——账本是下一轮去重的唯一依据，
      // 写丢了会让同一条告警每个 tick 重发一次。
      this.logger.warn(
        `notification_logs 写入失败（${input.code} → ${to.email}），` +
          `下一轮去重会失效并重发 — ${String(err)}`,
      );
    }
  }
}

/** 纯文本 + 简单 HTML 两份。运营邮件不做花样排版——能在手机通知栏读清楚就够。 */
export function renderAlert(input: OperatorAlertInput): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `${SUBJECT_PREFIX} ${input.subject}`;
  const textLines = [...input.lines];
  const htmlParts = input.lines.map((l) => `<p>${escapeHtml(l)}</p>`);
  if (input.link) {
    textLines.push("", `处理：${input.link}`);
    htmlParts.push(
      `<p><a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`,
    );
  }
  return {
    subject,
    text: textLines.join("\n"),
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.6">${htmlParts.join("")}</div>`,
  };
}
