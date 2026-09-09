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
  | "announcement.published"
  | "tenant.invitation"
  /* owner 2026-09-09:「我订阅了产品，付费，放弃付费，订单取消，都有操作…
     如果没有，那就是发消息方有纰漏」。下面四条补的就是那几处——每一条都对应一个
     **已经在跑的方法**（declarePayment / cancel / cancel(kind=expired) /
     convertPersonalToOrganization），只是此前一句话都不发。 */
  | "order.payment_declared"
  | "order.cancelled"
  | "order.expired"
  | "tenant.converted";

export type NotificationReferenceType =
  | "subscription"
  | "order"
  | "refund"
  | "announcement"
  | "invitation"
  | "tenant";

/**
 * 偏好主题（与 @vxture/service-account NOTIFICATION_TOPICS 同一集合）。
 *
 * 这里只列**本包发得出模板**的那几个；那边的全集还含事件源已存在、模板待接的六个
 * （界面标「开发中」）。两边不一致会被 `topicOf` 的穷尽映射挡住——它对每个模板键
 * 显式给主题，加模板忘了给主题就编译不过。
 */
export type NotificationTopic =
  | "subscription_expiry"
  | "provision_result"
  | "payment_due"
  | "refund_progress"
  | "announcement"
  | "member_invitation"
  | "order_status"
  | "tenant_change";

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
  "tenant.invitation": "{{tenantName}} 邀请你加入",
  "order.payment_declared": "已收到你的付款信息：订单 {{orderNo}}",
  "order.cancelled": "订单已取消：{{orderNo}}",
  "order.expired": "订单已关闭：{{orderNo}}",
  "tenant.converted": "{{tenantName}} 已升为组织租户",
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
  /* 只说机制:谁、什么身份、到什么时候截止。不写「欢迎加入」这类替对方做决定的话——
     这条消息的意义就是那个决定还没做。 */
  "tenant.invitation":
    "{{inviterName}} 邀请你以「{{roleName}}」身份加入 {{tenantName}}，{{expiresAt}} 前有效。",
  /* 只说机制，不做承诺：核对要多久由人工决定，写「很快」就是替他们许诺。 */
  "order.payment_declared":
    "金额 {{amount}}。我们会核对到账情况，确认后订单自动开通；在此之前订单保持待确认。",
  "order.cancelled": "订单 {{orderNo}}（{{productName}}）已取消，未产生费用。",
  /* 「放弃付费」的机制面：付款窗口到点，订单自己关。不写「你放弃了」——
     人可能只是没看到，说他放弃是在替他下结论。 */
  "order.expired":
    "付款窗口已过，订单 {{orderNo}}（{{productName}}）自动关闭，未产生费用。需要的话可以重新下单。",
  "tenant.converted":
    "{{tenantName}} 已从个人租户升为组织租户，现在可以邀请成员、按角色分配权限。原有订阅与用量记录不变。",
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
  "tenant.invitation": "{{tenantName}} invited you to join",
  "order.payment_declared": "Payment details received: order {{orderNo}}",
  "order.cancelled": "Order cancelled: {{orderNo}}",
  "order.expired": "Order closed: {{orderNo}}",
  "tenant.converted": "{{tenantName}} is now an organization tenant",
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
  "tenant.invitation":
    "{{inviterName}} invited you to join {{tenantName}} as {{roleName}}. The invitation is valid until {{expiresAt}}.",
  "order.payment_declared":
    "Amount {{amount}}. We will check the payment against our records; the order activates once confirmed and stays pending until then.",
  "order.cancelled":
    "Order {{orderNo}} ({{productName}}) has been cancelled. Nothing was charged.",
  "order.expired":
    "The payment window has passed, so order {{orderNo}} ({{productName}}) closed automatically. Nothing was charged. You can place a new order whenever you need it.",
  "tenant.converted":
    "{{tenantName}} has been upgraded from a personal tenant to an organization tenant. You can now invite members and assign permissions by role. Existing subscriptions and usage records are unchanged.",
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

/**
 * 模板 → 偏好主题。**逐条显式映射，不按前缀猜**（owner 2026-09-08）。
 *
 * 旧实现按前缀分三档，于是 `order.fulfilled`（开通成功）与 `order.renewal_created`
 * （有单要付）落进同一个「账单」主题，退款四态也一起——客户想只收「退款完成」做不到，
 * 想关掉催款又会连开通通知一起关掉。主题要贴着**用户关心的那件事**切，而不是贴着
 * 模板键的前缀。
 *
 * 用 `Record` 而不是 if 链：加模板时忘了给主题**编译不过**，不会静默落进某个兜底档。
 */
const TOPIC_OF: Record<NotificationTemplateCode, NotificationTopic> = {
  "subscription.expiring_soon": "subscription_expiry",
  "subscription.expired": "subscription_expiry",
  "subscription.renewed": "subscription_expiry",
  "order.fulfilled": "provision_result",
  "order.renewal_created": "payment_due",
  "refund.requested": "refund_progress",
  "refund.approved": "refund_progress",
  "refund.rejected": "refund_progress",
  "refund.completed": "refund_progress",
  "announcement.published": "announcement",
  "tenant.invitation": "member_invitation",
  /* 三条订单生命周期事件同一个主题:它们回答的是同一个问题——「我那个订单最后
     怎么样了」。不塞进 payment_due(那是「有单要付」)或 provision_result
     (那是「开通了吗」):主题要贴着用户关心的那件事切,不贴模板键的前缀。 */
  "order.payment_declared": "order_status",
  "order.cancelled": "order_status",
  "order.expired": "order_status",
  "tenant.converted": "tenant_change",
};

export function topicOf(code: NotificationTemplateCode): NotificationTopic {
  return TOPIC_OF[code];
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

/**
 * 短信模板变量（P2-i）。阿里云通知类模板变量有长度上限（20 字），这里统一截断；金额去掉货币符号
 * （模板里写死「元」）。键名 = 报备模板里的 ${var}，见 deploy/secrets/platform-sms.env.example。
 */
export function smsParams(
  code: NotificationTemplateCode,
  params: TemplateParams,
): Record<string, string> {
  const s = (v: unknown, n = 20) => String(v ?? "").slice(0, n);
  const money = (v: unknown) => s(String(v ?? "").replace(/[^0-9.]/g, ""));
  const product = s(params.productName);
  const plan = s(params.planName);
  const order = s(params.orderNo);
  switch (code) {
    case "subscription.expiring_soon":
      return { product, plan, date: s(params.endAt), days: s(params.days) };
    case "subscription.expired":
      return { product, plan, date: s(params.endAt) };
    case "subscription.renewed":
      return {
        product,
        plan,
        date: s(params.endAt),
        amount: money(params.amount),
      };
    case "order.fulfilled":
      return {
        product,
        plan,
        order,
        date: s(params.endAt),
        amount: money(params.amount),
      };
    case "order.renewal_created":
      return {
        product,
        plan,
        order,
        amount: money(params.amount),
        date: s(params.payBy),
      };
    case "refund.rejected":
      return { order, reason: s(params.reason) };
    case "refund.requested":
    case "refund.approved":
    case "refund.completed":
      return { order, amount: money(params.amount) };
    case "announcement.published":
      return { title: s(params.title) };
    default:
      return {};
  }
}

/** 环境变量 `ALIYUN_SMS_TPL_<模板键大写下划线>` → 阿里云模板码；没配的模板不发短信。 */
export function smsTemplatesFromEnv(
  env: Record<string, string | undefined> = process.env,
): Partial<Record<NotificationTemplateCode, string>> {
  const out: Partial<Record<NotificationTemplateCode, string>> = {};
  for (const code of Object.keys(TITLES_ZH) as NotificationTemplateCode[]) {
    const key = `ALIYUN_SMS_TPL_${code.toUpperCase().replace(/[.\-]/g, "_")}`;
    const v = env[key]?.trim();
    if (v) out[code] = v;
  }
  return out;
}

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
