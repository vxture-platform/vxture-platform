/**
 * templates.ts — 客户通知模板（product_330 P2-g / P2-h）。zh-CN + en-US，按收件人语言渲染。
 * @package @vxture/service-notification
 *
 * owner 规则：只写机制、不写承诺（"到期后权益停止""可随时续费"是机制描述）。
 * 参数一律 `{{name}}` 插值，渲染时 HTML 转义（邮件）——参数来自库里的产品名 / 单号 / 金额字符串。
 * 注意：两种语言各自一张平表（键 → 文案）；不要写成九个同形对象字面量——Sonar CPD 会按
 * 字面量归一化把它们判成重复块。
 */

export type NotificationTemplateCode =
  | "subscription.expiring_soon"
  | "subscription.expired"
  | "subscription.renewed"
  | "order.fulfilled"
  | "order.renewal_created"
  | "refund.requested"
  | "refund.approved"
  | "refund.rejected"
  | "refund.completed"
  | "announcement.published";

export type NotificationReferenceType =
  | "subscription"
  | "order"
  | "refund"
  | "announcement";

/** 偏好主题（与 @vxture/service-account NOTIFICATION_TOPICS 同一集合）。 */
export type NotificationTopic =
  | "account"
  | "security"
  | "subscription"
  | "billing"
  | "usage"
  | "product";

export type NotificationLocale = "zh-CN" | "en-US";

export interface TemplateDef {
  topic: NotificationTopic;
  title: string;
  body: string;
}

const TITLES_ZH: Record<NotificationTemplateCode, string> = {
  "subscription.expiring_soon": "订阅即将到期：{{productName}} {{planName}}",
  "subscription.expired": "订阅已到期：{{productName}} {{planName}}",
  "subscription.renewed": "订阅已续费：{{productName}} {{planName}}",
  "order.fulfilled": "订阅已开通：{{productName}} {{planName}}",
  "order.renewal_created": "续费订单待付款：{{productName}} {{planName}}",
  "refund.requested": "退款申请已收到：订单 {{orderNo}}",
  "refund.approved": "退款已审核通过：订单 {{orderNo}}",
  "refund.rejected": "退款申请未通过：订单 {{orderNo}}",
  "refund.completed": "退款已完成：订单 {{orderNo}}",
  "announcement.published": "{{title}}",
};

const BODIES_ZH: Record<NotificationTemplateCode, string> = {
  "subscription.expiring_soon":
    "将于 {{endAt}} 到期（{{days}} 天后）。未开启自动续费，到期后权益停止；可在「我的订阅」续费或开启自动续费。",
  "subscription.expired":
    "已于 {{endAt}} 到期，权益已停止。随时可在「我的订阅」续费恢复。",
  "subscription.renewed": "新周期至 {{endAt}}，实付 {{amount}}。",
  "order.fulfilled":
    "订单 {{orderNo}} 已开通，有效期至 {{endAt}}，实付 {{amount}}。",
  "order.renewal_created":
    "已按自动续费生成续费订单 {{orderNo}}，应付 {{amount}}，请在 {{payBy}} 前完成付款；逾期订单关闭，订阅到期后权益停止。",
  "refund.requested": "退款金额 {{amount}}，我们会尽快审核。",
  "refund.approved": "退款 {{amount}} 将按原付款渠道退回，到账后另行通知。",
  "refund.rejected": "原因：{{reason}}。如有疑问请联系客服。",
  "refund.completed":
    "退款 {{amount}} 已退回原付款渠道，订阅已回到未订阅状态。",
  "announcement.published": "{{content}}",
};

const TITLES_EN: Record<NotificationTemplateCode, string> = {
  "subscription.expiring_soon":
    "Subscription expiring soon: {{productName}} {{planName}}",
  "subscription.expired": "Subscription expired: {{productName}} {{planName}}",
  "subscription.renewed": "Subscription renewed: {{productName}} {{planName}}",
  "order.fulfilled": "Subscription activated: {{productName}} {{planName}}",
  "order.renewal_created":
    "Renewal order awaiting payment: {{productName}} {{planName}}",
  "refund.requested": "Refund request received: order {{orderNo}}",
  "refund.approved": "Refund approved: order {{orderNo}}",
  "refund.rejected": "Refund request declined: order {{orderNo}}",
  "refund.completed": "Refund completed: order {{orderNo}}",
  "announcement.published": "{{title}}",
};

const BODIES_EN: Record<NotificationTemplateCode, string> = {
  "subscription.expiring_soon":
    "Expires on {{endAt}} ({{days}} days from now). Auto-renew is off, so access stops at expiry; renew or enable auto-renew under My subscriptions.",
  "subscription.expired":
    "Expired on {{endAt}}; access has stopped. You can renew anytime under My subscriptions.",
  "subscription.renewed": "New period runs until {{endAt}}; paid {{amount}}.",
  "order.fulfilled":
    "Order {{orderNo}} is active until {{endAt}}; paid {{amount}}.",
  "order.renewal_created":
    "Auto-renew created renewal order {{orderNo}} for {{amount}}. Please pay before {{payBy}}; unpaid orders close and access stops at expiry.",
  "refund.requested": "Refund amount {{amount}}. We will review it shortly.",
  "refund.approved":
    "The refund of {{amount}} will be returned via the original payment channel; you will be notified when it lands.",
  "refund.rejected":
    "Reason: {{reason}}. Contact support if you have questions.",
  "refund.completed":
    "The refund of {{amount}} has been returned via the original payment channel and the subscription is back to unsubscribed.",
  "announcement.published": "{{content}}",
};

const FOOTER: Record<NotificationLocale, string> = {
  "zh-CN": "此邮件由系统自动发送；通知偏好可在控制台「通知设置」调整。",
  "en-US":
    "This email was sent automatically; notification preferences can be changed under Notifications in the console.",
};

const TABLES: Record<
  NotificationLocale,
  {
    titles: Record<NotificationTemplateCode, string>;
    bodies: Record<NotificationTemplateCode, string>;
  }
> = {
  "zh-CN": { titles: TITLES_ZH, bodies: BODIES_ZH },
  "en-US": { titles: TITLES_EN, bodies: BODIES_EN },
};

/** 偏好主题由模板键前缀决定：subscription.* → subscription；announcement.* → product；其余（order / refund）→ billing。 */
export function topicOf(code: NotificationTemplateCode): NotificationTopic {
  if (code.startsWith("subscription.")) return "subscription";
  if (code.startsWith("announcement.")) return "product";
  return "billing";
}

/** 收件人语言 → 模板语言：en* → en-US，其余（含 null）→ zh-CN。 */
export function localeOf(
  language: string | null | undefined,
): NotificationLocale {
  return language?.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

/** 模板注册表（zh-CN 视图，供测试 / 列举）。 */
export const NOTIFICATION_TEMPLATES: Record<
  NotificationTemplateCode,
  TemplateDef
> = Object.fromEntries(
  (Object.keys(TITLES_ZH) as NotificationTemplateCode[]).map((code) => [
    code,
    { topic: topicOf(code), title: TITLES_ZH[code], body: BODIES_ZH[code] },
  ]),
) as Record<NotificationTemplateCode, TemplateDef>;

export type TemplateParams = Record<string, string | number>;

/** `{{name}}` 插值；缺参留空串（不抛：通知不因一个参数缺失而丢）。 */
export function interpolate(template: string, params: TemplateParams): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = params[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderedNotification {
  title: string;
  body: string;
  subject: string;
  html: string;
  text: string;
}

export function render(
  code: NotificationTemplateCode,
  params: TemplateParams,
  absoluteLink: string | null,
  locale: NotificationLocale = "zh-CN",
): RenderedNotification {
  const t = TABLES[locale];
  const title = interpolate(t.titles[code], params);
  const body = interpolate(t.bodies[code], params);
  const subject = `[Vxture] ${title}`;
  const linkHtml = absoluteLink
    ? `<p><a href="${escapeHtml(absoluteLink)}">${escapeHtml(absoluteLink)}</a></p>`
    : "";
  const footer = FOOTER[locale];
  const html = `<p>${escapeHtml(title)}</p><p>${escapeHtml(body)}</p>${linkHtml}<p style="color:#888;font-size:12px">${escapeHtml(footer)}</p>`;
  const text = `${title}\n\n${body}${absoluteLink ? `\n\n${absoluteLink}` : ""}\n\n${footer}`;
  return { title, body, subject, html, text };
}
