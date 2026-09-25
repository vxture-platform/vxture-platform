/**
 * customer-notifier.ts — 客户通知的最小契约（product_330 P2-g，owner 2026-09-03「通知先做站内 + 邮件」）。
 * @package @vxture/service-subscription
 *
 * 订阅 / 订单服务只描述「发生了什么」（模板键 + 参数 + 业务引用），不知道站内 / 邮件怎么发——
 * 发送、去重、偏好、账本由 @vxture/service-notification 的 NotificationDispatcher 实现，
 * 三个 BFF 在装配处把它以本接口注入（结构兼容，不引包）。未注入 = 静默不发（本地 / 单测）。
 * 通知一律 best-effort：业务写已提交，通知失败只记日志。
 */

export type CustomerNotificationTemplate =
  | "subscription.expiring_soon"
  | "subscription.expired"
  | "subscription.renewed"
  | "order.fulfilled"
  | "order.renewal_created"
  | "refund.requested"
  | "refund.approved"
  | "refund.rejected"
  | "refund.completed"
  /* owner 2026-09-09:补上此前一句话都不发的三处订单事件。
     每一条都对应一个已经在跑的方法,不是新流程。 */
  | "order.payment_declared"
  | "order.cancelled"
  | "order.expired"
  /* owner 2026-09-25:退订此前一句话都不发。三条按**退款结果**分，不按动作分——
     客户点的是「退订」，想知道的是「我的钱怎么样了」。见 dispatch/templates.ts。 */
  | "subscription.cancelled_refunded"
  | "subscription.cancelled_no_charge"
  | "subscription.cancelled_no_refund"
  /* 2026-09-25 状态机定稿（批 2）：五条「事情发生了但没人告诉客户」。overdue 是新接上的
     「欠费宽限」那一档；suspended / resumed 是运营冻结与恢复；payment_rejected 此前只有
     付款页横幅；restored 是运营把关掉的单救回来。**这张联合是 dispatch/templates.ts 那
     张的第二份**——加模板要同时改两处，少改一处这边编译不过（这是好事）。 */
  | "subscription.overdue"
  | "subscription.suspended"
  | "subscription.resumed"
  | "order.payment_rejected"
  | "order.restored"
  /* 2026-09-25 批 3：退款执行失败。批 2 本想加它，当时撤掉了——那会儿 `failed` 全仓
     零写入方，先加模板就是一处「做了没接」。本批把 `failRefund` 这条路补上了。 */
  | "refund.failed";

export interface CustomerNotifyInput {
  tenantId: string;
  templateCode: CustomerNotificationTemplate;
  reference: { type: "subscription" | "order" | "refund"; id: string };
  params: Record<string, string | number>;
  /** 额外收件人 account id（租户 owner 永远包含，由 dispatcher 合并）。 */
  recipients?: string[] | undefined;
  /** console 内相对路径。 */
  link?: string | undefined;
}

export interface CustomerNotifier {
  notify(input: CustomerNotifyInput): Promise<unknown>;
}

/** Nest 注入令牌（可选依赖）。 */
export const CUSTOMER_NOTIFIER = Symbol("CUSTOMER_NOTIFIER");

/** 金额展示：¥ + 两位小数（资金类字符串不走浮点运算，只格式化）。 */
export function formatNotifyMoney(
  amount: string | number,
  currency = "CNY",
): string {
  const n = Number(amount);
  const fixed = Number.isFinite(n) ? n.toFixed(2) : String(amount);
  return currency === "CNY" ? `¥${fixed}` : `${fixed} ${currency}`;
}

/** 日期展示：Asia/Shanghai 的 YYYY-MM-DD（客户看的是本地日历日，不是 UTC 时刻）。 */
export function formatNotifyDate(d: Date | null | undefined): string {
  if (!d) return "—";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** 收件人：租户 owner（缺省）+ 订单的客户下单人（去重由 dispatcher 做）。 */
export function customerRecipients(
  createdByType: string | null | undefined,
  createdById: string | null | undefined,
): string[] | undefined {
  return createdByType === "customer" && createdById
    ? [createdById]
    : undefined;
}
