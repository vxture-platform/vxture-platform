/**
 * closure.types.ts — 租户清账快照(删除账号资格判定的读侧,050-account §7)。
 * @package @vxture/service-billing
 */

export interface TenantClosureSnapshot {
  tenantId: string;
  /** bill_status in (unpaid, paying, partial, overdue) 的账单数。 */
  unpaidBills: number;
  currency: string;
  /** credits.balance,两位小数字符串。 */
  balance: string;
  /** 付费余额 = min(balance, Σrecharge − Σrefund)(先消耗赠送)。 */
  paidBalance: string;
  /** 赠送余额 = balance − 付费余额。 */
  giftedBalance: string;
  /** 审核中,或已批准但尚未打款成功 / 失败的退款数。 */
  refundsInProgress: number;
  /** 申请中 / 已批准未开出的发票数。 */
  receiptsInProgress: number;
  /** 一分钱没收到、可以直接取消的待付订单 id。 */
  pendingOrdersCancellable: string[];
  /** 已有实收或有待核实付款腿的待付订单数(取消会 409)。 */
  pendingOrdersWithMoney: number;
  /** 未到期(含试用 / 逾期 / 暂停)的订阅数。 */
  unexpiredSubscriptions: number;
}
