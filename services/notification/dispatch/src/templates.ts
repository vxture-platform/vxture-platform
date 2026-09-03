/**
 * templates.ts — 客户通知模板（product_330 P2-g）。zh-CN 内联；i18n 待做（模板键稳定，文案可换）。
 * @package @vxture/service-notification
 *
 * owner 规则：只写机制、不写承诺（"到期后权益停止""可随时续费"是机制描述）。
 * 参数一律 `{{name}}` 插值，渲染时 HTML 转义（邮件）——参数来自库里的产品名 / 单号 / 金额字符串。
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
  | "refund.completed";

export type NotificationReferenceType = "subscription" | "order" | "refund";

/** 偏好主题：subscription.* → subscription；order.* / refund.* → billing。 */
export type NotificationTopic = "subscription" | "billing";

export interface TemplateDef {
  topic: NotificationTopic;
  title: string;
  body: string;
}

export const NOTIFICATION_TEMPLATES: Record<
  NotificationTemplateCode,
  TemplateDef
> = {
  "subscription.expiring_soon": {
    topic: "subscription",
    title: "订阅即将到期：{{productName}} {{planName}}",
    body: "将于 {{endAt}} 到期（{{days}} 天后）。未开启自动续费，到期后权益停止；可在「我的订阅」续费或开启自动续费。",
  },
  "subscription.expired": {
    topic: "subscription",
    title: "订阅已到期：{{productName}} {{planName}}",
    body: "已于 {{endAt}} 到期，权益已停止。随时可在「我的订阅」续费恢复。",
  },
  "subscription.renewed": {
    topic: "subscription",
    title: "订阅已续费：{{productName}} {{planName}}",
    body: "新周期至 {{endAt}}，实付 {{amount}}。",
  },
  "order.fulfilled": {
    topic: "billing",
    title: "订阅已开通：{{productName}} {{planName}}",
    body: "订单 {{orderNo}} 已开通，有效期至 {{endAt}}，实付 {{amount}}。",
  },
  "order.renewal_created": {
    topic: "billing",
    title: "续费订单待付款：{{productName}} {{planName}}",
    body: "已按自动续费生成续费订单 {{orderNo}}，应付 {{amount}}，请在 {{payBy}} 前完成付款；逾期订单关闭，订阅到期后权益停止。",
  },
  "refund.requested": {
    topic: "billing",
    title: "退款申请已收到：订单 {{orderNo}}",
    body: "退款金额 {{amount}}，我们会尽快审核。",
  },
  "refund.approved": {
    topic: "billing",
    title: "退款已审核通过：订单 {{orderNo}}",
    body: "退款 {{amount}} 将按原付款渠道退回，到账后另行通知。",
  },
  "refund.rejected": {
    topic: "billing",
    title: "退款申请未通过：订单 {{orderNo}}",
    body: "原因：{{reason}}。如有疑问请联系客服。",
  },
  "refund.completed": {
    topic: "billing",
    title: "退款已完成：订单 {{orderNo}}",
    body: "退款 {{amount}} 已退回原付款渠道，订阅已回到未订阅状态。",
  },
};

export function topicOf(code: NotificationTemplateCode): NotificationTopic {
  return NOTIFICATION_TEMPLATES[code].topic;
}

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
): RenderedNotification {
  const def = NOTIFICATION_TEMPLATES[code];
  const title = interpolate(def.title, params);
  const body = interpolate(def.body, params);
  const subject = `[Vxture] ${title}`;
  const linkHtml = absoluteLink
    ? `<p><a href="${escapeHtml(absoluteLink)}">${escapeHtml(absoluteLink)}</a></p>`
    : "";
  const html = `<p>${escapeHtml(title)}</p><p>${escapeHtml(body)}</p>${linkHtml}<p style="color:#888;font-size:12px">此邮件由系统自动发送；通知偏好可在控制台「通知设置」调整。</p>`;
  const text = `${title}\n\n${body}${absoluteLink ? `\n\n${absoluteLink}` : ""}\n\n此邮件由系统自动发送；通知偏好可在控制台「通知设置」调整。`;
  return { title, body, subject, html, text };
}
