/**
 * customer-notifier.ts — 客户通知的最小契约（product_330 P2-g，owner 2026-09-03「通知先做站内 + 邮件」）。
 * @package @vxture/service-subscription
 *
 * 订阅 / 订单服务只描述「发生了什么」（模板键 + 参数 + 业务引用），不知道站内 / 邮件怎么发——
 * 发送、去重、偏好、账本由 @vxture/service-notification 的 NotificationDispatcher 实现，
 * 三个 BFF 在装配处把它以本接口注入（结构兼容，不引包）。未注入 = 静默不发（本地 / 单测）。
 * 通知一律 best-effort：业务写已提交，通知失败只记日志。
 */

/**
 * 客户通知模板码 —— **dispatch/templates.ts 那张联合的第二份副本**，按设计同改。
 *
 * 2026-09-28 批 5 改成「`as const` 数组 + 派生联合」而不是手写联合：两份副本是否一致，
 * 此前**在运行时无从断言**（联合是类型，类型在运行时不存在），只能靠人记得。现在数组
 * 就是联合本身，dispatch 那边的 spec 拿它与 `NOTIFICATION_TEMPLATES` 的键集合对账。
 *
 * 这份副本是权威那张的**子集**，不是复制品：只列**写入方住在本包**的模板码。不在本包
 * 里发的（公告、入组邀请、租户升组织、企业认证结果——后者的写入方是 admin-bff 的
 * reviewVerification）不进来，否则这张类型就在替别的包声明它能发什么。缺哪几个、为什么
 * 缺，钉在 dispatch 的 templates.spec.ts 里：加了权威码却两处都没动的，那条用例会红。
 */
export const CUSTOMER_NOTIFICATION_TEMPLATES = [
  "subscription.expiring_soon",
  "subscription.expired",
  "subscription.renewed",
  "order.fulfilled",
  "order.renewal_created",
  "refund.requested",
  "refund.approved",
  "refund.rejected",
  "refund.completed",
  /* owner 2026-09-09:补上此前一句话都不发的三处订单事件。
     每一条都对应一个已经在跑的方法,不是新流程。 */
  "order.payment_declared",
  "order.cancelled",
  "order.expired",
  /* owner 2026-09-25:退订此前一句话都不发。三条按**退款结果**分，不按动作分——
     客户点的是「退订」，想知道的是「我的钱怎么样了」。见 dispatch/templates.ts。 */
  "subscription.cancelled_refunded",
  "subscription.cancelled_no_charge",
  "subscription.cancelled_no_refund",
  /* 2026-09-25 状态机定稿（批 2）：五条「事情发生了但没人告诉客户」。overdue 是新接上的
     「欠费宽限」那一档；suspended / resumed 是运营冻结与恢复；payment_rejected 此前只有
     付款页横幅；restored 是运营把关掉的单救回来。 */
  "subscription.overdue",
  "subscription.suspended",
  "subscription.resumed",
  /* 暂停到点被终止（2026-09-25 步骤三）：服务不会再恢复。 */
  "subscription.suspension_ended",
  "order.payment_rejected",
  "order.restored",
  /* 2026-09-25 批 3：退款执行失败。批 2 本想加它，当时撤掉了——那会儿 `failed` 全仓
     零写入方，先加模板就是一处「做了没接」。本批把 `failRefund` 这条路补上了。 */
  "refund.failed",
  /* 2026-12-01 退款转账线：`processing` 终于有了写入方（initiateRefundTransfer），
     「退款已打出」这一条随它一起加。approved / completed 各拆出「按原付款渠道退回」的
     一条：钱退到「你提供的收款账户」还是「原付款渠道」是两种处境，各一句完整的话，
     不在一条模板里写「或者…或者」（与 subscription.cancelled_* 三条同一判据）。 */
  "refund.transfer_initiated",
  "refund.approved_original_channel",
  "refund.completed_original_channel",
  /* 2026-09-28 批 5：试用到期与加油包四态。五条的写入方都在本包——
     试用到期在 subscription.service 的 sweepLapsedTrials，加油包开通在付款确认之后，
     即将到期 / 用尽 / 过期来自加油包池巡检（每趟重扫同一批行，去重靠收件箱唯一键，
     与 notifyExpiringSoon 同一形状）。企业认证那两条不在这里：写入方是 admin-bff。 */
  "subscription.trial_expired",
  "addon.activated",
  "addon.expiring_soon",
  "addon.exhausted",
  "addon.expired",
  /* 2026-09-28 收尾：运营代客续期。写入方在本包——`notifyOperatorStatusChange` 的第三
     档（admin-bff 的裸 SQL 事务提交后调它）。不复用 `subscription.renewed`：那条的正文
     要说实付金额，而代客续期没有订单、没有付款。 */
  "subscription.renewed_by_operator",
  /* 2026-09-28 收尾：产品升级维护的暂停。写入方在本包——`sweepProductMaintenance` 的第 1
     段（进窗口）。人工暂停仍发 `subscription.suspended`（那条的「联系客服」对人工暂停是
     对的），两条的分岔是**暂停原因**，不是新加的标记。 */
  "subscription.suspended_maintenance",
] as const;

export type CustomerNotificationTemplate =
  (typeof CUSTOMER_NOTIFICATION_TEMPLATES)[number];

export interface CustomerNotifyInput {
  tenantId: string;
  templateCode: CustomerNotificationTemplate;
  /**
   * 业务引用 = 去重锚（收件箱唯一键的一半）。**id 一律是可视码或可视值的组合**，不放 uuid。
   *
   * 2026-09-28 批 5 加 `addon`：加油包的引用 id 是 `metering.addon_purchases.order_no`
   * （可视码），而这个类型**不能写成 `order`**——那个值在派发侧的含义是
   * `billing.orders` 的行，复用它会让按引用解析可视码 / 拼 admin 链接的消费方查错表，
   * 拿到一个确定的错答案（一条点开 404 的死链），而不是一个报错。文案参数里的单号仍
   * 叫 `orderNo`（全仓一套词汇）：区分两张表是**引用类型**的职责，不是参数名的。
   * 这张联合比派发侧那张窄，同样是有意的：只列本包发得出的那几种。
   */
  reference: {
    type: "subscription" | "order" | "refund" | "addon";
    id: string;
  };
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
