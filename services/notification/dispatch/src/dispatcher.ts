/**
 * dispatcher.ts — 客户通知分发（product_330 P2-g，owner 2026-09-03「通知先做站内 + 邮件」）。
 * @package @vxture/service-notification
 *
 * 一条业务通知 → 每个收件人：
 *   1. 站内：insert support.inbox_messages（唯一键 收件人 × 模板 × 业务引用；冲突 = 已通知过 → 整条跳过）
 *      并记 notification_logs(channel=inapp, delivered)。
 *   2. 邮件：站内落成 且 注入了 sender 且 偏好允许 → 查邮箱 → 发；成功 / 失败各记一行 logs。
 * 文案按收件人语言渲染（account.user_profiles.language，en* → en-US，其余 zh-CN；P2-h）；
 * 公告类通知自带标题 / 正文（announcement.lang 已定），不走模板表。
 * 全程 best-effort：单个收件人失败只记日志，方法不抛（除非收件人查询本身失败）。
 * 收件人 = 调用方给的 ∪ 租户 owner。
 */
import type { Pool } from "pg";
import {
  localeOf,
  render,
  smsParams,
  topicOf,
  type NotificationLocale,
  type NotificationReferenceType,
  type NotificationTemplateCode,
  type NotificationTopic,
  type TemplateParams,
} from "./templates";

export interface NotifyInput {
  tenantId: string;
  templateCode: NotificationTemplateCode;
  /** id 可为复合键，如 `${subscriptionId}:${endAtDate}`（同一到期只通知一次）。 */
  reference: { type: NotificationReferenceType; id: string };
  params: TemplateParams;
  /** 额外收件人 account id；租户 owner 永远包含。 */
  recipients?: string[] | undefined;
  /** console 内相对路径，或（公告 CTA）绝对 URL。 */
  link?: string | undefined;
}

export interface MailSender {
  send(p: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
}

/** 短信发送方（P2-i）：阿里云短信服务 SendSms，模板码 + 变量；返回回执 id（BizId）。 */
export interface SmsSender {
  sendTemplate(input: {
    phone: string;
    templateCode: string;
    params: Record<string, string>;
    outId?: string;
  }): Promise<string | null>;
}

export interface PreferenceGate {
  allows(
    userId: string,
    topic: NotificationTopic,
    channel: "inbox" | "email" | "sms",
  ): Promise<boolean>;
}

export interface NotifyLogger {
  warn(message: string): void;
  error?(message: string): void;
}

export interface NotificationDispatcherOptions {
  mail?: MailSender | null | undefined;
  /** 短信：sender + 模板键 → 阿里云模板码（缺模板码的通知不发短信）。 */
  sms?: SmsSender | null | undefined;
  smsTemplates?: Partial<Record<NotificationTemplateCode, string>> | undefined;
  prefs?: PreferenceGate | null | undefined;
  /** 写进 notification_logs.provider；默认 "smtp"。 */
  provider?: string | undefined;
  /** 邮件里链接的绝对前缀（如 https://console.vxture.com）；未设则相对链接不进邮件。 */
  consoleBaseUrl?: string | null | undefined;
  logger?: NotifyLogger | undefined;
}

export interface NotifyResult {
  inboxCreated: number;
  emailsSent: number;
  emailsFailed: number;
  smsSent: number;
  smsFailed: number;
  skipped: number;
}

export class NotificationDispatcher {
  private readonly mail: MailSender | null;
  private readonly sms: SmsSender | null;
  private readonly smsTemplates: Partial<
    Record<NotificationTemplateCode, string>
  >;
  private readonly prefs: PreferenceGate | null;
  private readonly provider: string;
  private readonly consoleBaseUrl: string | null;
  private readonly logger: NotifyLogger;

  constructor(
    private readonly pool: Pool,
    options: NotificationDispatcherOptions = {},
  ) {
    this.mail = options.mail ?? null;
    this.sms = options.sms ?? null;
    this.smsTemplates = options.smsTemplates ?? {};
    this.prefs = options.prefs ?? null;
    this.provider = options.provider ?? "smtp";
    this.consoleBaseUrl = options.consoleBaseUrl?.replace(/\/$/, "") ?? null;
    this.logger = options.logger ?? {
      warn: (m) => console.warn(`[notification] ${m}`),
    };
  }

  async notify(input: NotifyInput): Promise<NotifyResult> {
    const result: NotifyResult = {
      inboxCreated: 0,
      emailsSent: 0,
      emailsFailed: 0,
      smsSent: 0,
      smsFailed: 0,
      skipped: 0,
    };
    const recipients = await this.resolveRecipients(input);
    if (recipients.length === 0) {
      result.skipped += 1;
      this.logger.warn(
        `${input.templateCode} ${input.reference.type}:${input.reference.id}: no recipient (tenant ${input.tenantId} has no owner)`,
      );
      return result;
    }
    const topic = topicOf(input.templateCode);
    const absoluteLink = this.absoluteLink(input.link);

    for (const accountId of recipients) {
      try {
        if (!(await this.allows(accountId, topic, "inbox"))) {
          result.skipped += 1;
          continue;
        }
        const recipient = await this.lookupRecipient(accountId);
        const rendered = render(
          input.templateCode,
          input.params,
          absoluteLink,
          recipient.locale,
        );
        const inserted = await this.pool.query<{ id: string }>(
          `insert into support.inbox_messages
             (tenant_id, account_id, template_code, title, body, link, reference_type, reference_id)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict on constraint uq_inbox_messages_dedupe do nothing
           returning id`,
          [
            input.tenantId,
            accountId,
            input.templateCode,
            rendered.title.slice(0, 256),
            rendered.body,
            input.link ?? null,
            input.reference.type,
            input.reference.id,
          ],
        );
        if (inserted.rowCount === 0) {
          result.skipped += 1; // 已通知过（唯一键）
          continue;
        }
        result.inboxCreated += 1;
        await this.log({
          tenantId: input.tenantId,
          accountId,
          channel: "inapp",
          status: "delivered",
          templateCode: input.templateCode,
          reference: input.reference,
          recipient: accountId,
          subject: rendered.title,
          provider: "inbox",
          delivered: true,
        });

        await this.sendEmail(
          input,
          accountId,
          topic,
          recipient.email,
          rendered,
          result,
        );
        await this.sendSms(
          input,
          accountId,
          topic,
          recipient.phone,
          rendered,
          result,
        );
      } catch (err) {
        result.skipped += 1;
        this.logger.warn(
          `${input.templateCode} → account ${accountId}: ${String(err)}`,
        );
      }
    }
    return result;
  }

  /** 邮件：有 sender、偏好允许、有邮箱才发；成功 / 失败各记一行账本，不抛。 */
  private async sendEmail(
    input: NotifyInput,
    accountId: string,
    topic: NotificationTopic,
    email: string | null,
    rendered: { subject: string; html: string; text: string },
    result: NotifyResult,
  ): Promise<void> {
    if (!this.mail || !email) return;
    if (!(await this.allows(accountId, topic, "email"))) return;
    const outcome = await this.attempt(
      () =>
        this.mail!.send({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        }),
      `${input.templateCode} → ${email}: email failed`,
    );
    if (outcome.ok) result.emailsSent += 1;
    else result.emailsFailed += 1;
    await this.log({
      tenantId: input.tenantId,
      accountId,
      channel: "email",
      status: outcome.ok ? "sent" : "failed",
      templateCode: input.templateCode,
      reference: input.reference,
      recipient: email,
      subject: rendered.subject,
      provider: this.provider,
      ...(outcome.ok ? {} : { errorMessage: outcome.error }),
    });
  }

  /** 短信（P2-i）：有 sender、该模板配了阿里云模板码、偏好允许（默认关）、有手机号才发。 */
  private async sendSms(
    input: NotifyInput,
    accountId: string,
    topic: NotificationTopic,
    phone: string | null,
    rendered: { title: string },
    result: NotifyResult,
  ): Promise<void> {
    const templateCode = this.smsTemplates[input.templateCode];
    if (!this.sms || !templateCode || !phone) return;
    if (!(await this.allows(accountId, topic, "sms"))) return;
    let bizId: string | null = null;
    const outcome = await this.attempt(async () => {
      bizId = await this.sms!.sendTemplate({
        phone,
        templateCode,
        params: smsParams(input.templateCode, input.params),
        outId: `${input.reference.type}:${input.reference.id}`.slice(0, 64),
      });
    }, `${input.templateCode} → ${phone}: sms failed`);
    if (outcome.ok) result.smsSent += 1;
    else result.smsFailed += 1;
    await this.log({
      tenantId: input.tenantId,
      accountId,
      channel: "sms",
      status: outcome.ok ? "sent" : "failed",
      templateCode: input.templateCode,
      reference: input.reference,
      recipient: phone,
      subject: rendered.title,
      provider: "aliyun",
      providerMessageId: bizId,
      ...(outcome.ok ? {} : { errorMessage: outcome.error }),
    });
  }

  private async attempt(
    fn: () => Promise<unknown>,
    label: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      const error = String(err instanceof Error ? err.message : err).slice(
        0,
        2000,
      );
      this.logger.warn(`${label} — ${error}`);
      return { ok: false, error };
    }
  }

  /** 相对路径拼 console 前缀；已是绝对 URL（公告 CTA）原样进邮件；没前缀的相对路径不进邮件。 */
  private absoluteLink(link: string | undefined): string | null {
    if (!link) return null;
    if (/^https?:\/\//i.test(link)) return link;
    if (!this.consoleBaseUrl) return null;
    return `${this.consoleBaseUrl}${link.startsWith("/") ? "" : "/"}${link}`;
  }

  /** 调用方给的收件人 ∪ 租户 owner，去重、去空。 */
  private async resolveRecipients(input: NotifyInput): Promise<string[]> {
    const res = await this.pool.query<{ owner_user_id: string | null }>(
      `select owner_user_id from tenancy.tenants where id = $1`,
      [input.tenantId],
    );
    const owner = res.rows[0]?.owner_user_id ?? null;
    const set = new Set<string>();
    if (owner) set.add(owner);
    for (const r of input.recipients ?? []) if (r) set.add(r);
    return [...set];
  }

  private async allows(
    userId: string,
    topic: NotificationTopic,
    channel: "inbox" | "email" | "sms",
  ): Promise<boolean> {
    if (!this.prefs) return true;
    try {
      return await this.prefs.allows(userId, topic, channel);
    } catch (err) {
      // 偏好读不到按允许处理：宁可多发一封事务性通知，也不让偏好服务故障吞掉到期提醒。
      this.logger.warn(`preferences for ${userId} unreadable — ${String(err)}`);
      return true;
    }
  }

  /** 收件人邮箱 + 手机号 + 语言（一次查询）；查不到按 zh-CN、无邮箱无手机。 */
  private async lookupRecipient(accountId: string): Promise<{
    email: string | null;
    phone: string | null;
    locale: NotificationLocale;
  }> {
    const res = await this.pool.query<{
      email: string | null;
      phone: string | null;
      language: string | null;
    }>(
      `select u.email, u.phone, p.language
         from account.users u
         left join account.user_profiles p on p.user_id = u.id
        where u.id = $1 and u.deleted_at is null`,
      [accountId],
    );
    const row = res.rows[0];
    const email = row?.email?.trim();
    const phone = row?.phone?.trim();
    return {
      email: email ? email : null,
      phone: phone ? phone : null,
      locale: localeOf(row?.language),
    };
  }

  private async log(row: {
    tenantId: string;
    accountId: string;
    channel: "inapp" | "email" | "sms";
    status: "sent" | "delivered" | "failed";
    templateCode: NotificationTemplateCode;
    reference: { type: NotificationReferenceType; id: string };
    recipient: string;
    subject: string;
    provider: string;
    providerMessageId?: string | null;
    errorMessage?: string;
    delivered?: boolean;
  }): Promise<void> {
    try {
      await this.pool.query(
        `insert into support.notification_logs
           (tenant_id, account_id, channel, template_code, status, reference_type, reference_id,
            recipient, subject, provider, provider_message_id, error_message, delivered_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, case when $13::boolean then now() end)`,
        [
          row.tenantId,
          row.accountId,
          row.channel,
          row.templateCode,
          row.status,
          row.reference.type,
          row.reference.id,
          row.recipient.slice(0, 256),
          row.subject.slice(0, 256),
          row.provider,
          row.providerMessageId ?? null,
          row.errorMessage ?? null,
          row.delivered ?? false,
        ],
      );
    } catch (err) {
      this.logger.warn(`notification_logs write failed — ${String(err)}`);
    }
  }
}
