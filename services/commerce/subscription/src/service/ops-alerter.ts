/**
 * ops-alerter.ts — 运营告警的最小契约（#231，owner 2026-09-08 定档）。
 * @package @vxture/service-subscription
 *
 * 与 [[customer-notifier]] 同一手法：订单服务只描述「发生了什么」，不知道告警怎么送到人。
 * 发送、4h 静默窗口、账本由 @vxture/service-notification 的 OperatorAlertDispatcher 实现，
 * platform-api 在装配处以本接口注入（结构兼容，不引包）。未注入 = 静默不发（本地 / 单测）。
 *
 * 目前只有一个方法：**自愈放弃**。这一条必须由订单服务自己报，因为放弃与否只有它知道——
 * 失败计数 `reconcileFailures` 是**进程内存**里的 Map，外面任何扫描都看不见。
 * 另外两类待办（客户已申报付款 / 已收款未开通）是**订单态**，能从库里扫出来，
 * 所以由 platform-api 的 OpsTodoAlertJob 直接扫，不经过这个口子。
 */

export interface OpsSelfHealGaveUpInput {
  orderId: string;
  orderNo: string;
  /** 已失败次数（= RECONCILE_FAILURE_LIMIT 时即为放弃点）。 */
  attempts: number;
  /** 最后一次失败的原因；重启后计数归零重试，这里可能为空。 */
  lastError: string | null;
}

export interface OpsAlerter {
  orderSelfHealGaveUp(input: OpsSelfHealGaveUpInput): Promise<unknown>;
}
