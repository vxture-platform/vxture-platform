/**
 * proration.ts — 升级折抵（product_330 §4.1，owner 决策 2）纯函数。
 * @package @vxture/service-subscription
 *
 *   r       = days_left / days_total                 剩余时间比，[0,1]
 *   u       = Σ max(0, limit−used) / Σ limit         剩余消耗性配额比（按额度加权），[0,1]；无消耗性池 → 视为 0 且 α=0
 *   α       = 套餐主组件 consumable_share（默认 0.5；无消耗性池 0）
 *   credit  = round2( P_old × ((1−α)·r + α·u) )
 *   payable = max(0, P_new − credit)
 *   leftover= max(0, credit − P_new)                 折抵溢出，履约时进预付款余额
 *
 * free → 付费自然退化：P_old = 0 → credit 0。所有金额两位小数（资金铁律）。
 */

export interface ProrationInput {
  /** 原订阅本周期实付（元）；free 为 0 */
  pOld: number;
  /** 新套餐标价（元） */
  pNew: number;
  /** 原周期总天数（≥1） */
  daysTotal: number;
  /** 原周期剩余天数（会被夹到 [0, daysTotal]） */
  daysLeft: number;
  /** 剩余消耗性配额比 [0,1]；null = 原订阅没有消耗性池 */
  usageRemainingRatio: number | null;
  /** 套餐消耗性权重 [0,1]（无消耗性池时忽略） */
  consumableShare: number;
}

export interface ProrationResult {
  pOld: number;
  pNew: number;
  daysTotal: number;
  daysLeft: number;
  r: number;
  u: number;
  alpha: number;
  /** 时间折抵部分（元，两位小数） */
  creditTime: number;
  /** 用量折抵部分（元，两位小数） */
  creditUsage: number;
  credit: number;
  payable: number;
  leftover: number;
}

export const DEFAULT_CONSUMABLE_SHARE = 0.5;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function computeProration(input: ProrationInput): ProrationResult {
  const pOld = round2(Math.max(0, input.pOld));
  const pNew = round2(Math.max(0, input.pNew));
  const daysTotal = Math.max(1, Math.round(input.daysTotal));
  const daysLeft = Math.min(daysTotal, Math.max(0, Math.round(input.daysLeft)));
  const r = clamp01(daysLeft / daysTotal);
  const hasConsumable = input.usageRemainingRatio !== null;
  const u = hasConsumable ? clamp01(input.usageRemainingRatio as number) : 0;
  const alpha = hasConsumable ? clamp01(input.consumableShare) : 0;
  // 只对总额取整一次（公式原样），两部分仅作展示拆分：时间部分取整，用量部分取余数。
  const credit = round2(Math.min(pOld, pOld * ((1 - alpha) * r + alpha * u)));
  const creditTime = round2(Math.min(credit, pOld * (1 - alpha) * r));
  const creditUsage = round2(credit - creditTime);
  const payable = round2(Math.max(0, pNew - credit));
  const leftover = round2(Math.max(0, credit - pNew));
  return {
    pOld,
    pNew,
    daysTotal,
    daysLeft,
    r: Math.round(r * 10000) / 10000,
    u: Math.round(u * 10000) / 10000,
    alpha,
    creditTime,
    creditUsage,
    credit,
    payable,
    leftover,
  };
}

/** 整天数（向上取整，至少 1）：周期总长；剩余天数向下取整，不给未过完的一天算钱。 */
export function cycleDays(startAt: Date, endAt: Date): number {
  return Math.max(
    1,
    Math.ceil((endAt.getTime() - startAt.getTime()) / 86_400_000),
  );
}

export function daysLeftOf(endAt: Date, now: Date = new Date()): number {
  return Math.max(
    0,
    Math.floor((endAt.getTime() - now.getTime()) / 86_400_000),
  );
}

// ── 折算退（owner 2026-09-25）────────────────────────────────────────────────

export interface WindowRefundInput {
  /** 本单实付（元） */
  paid: number;
  /** 套餐消耗性权重 α [0,1]（与升级折抵同一个值、同一个来源） */
  alpha: number;
  /** 已消耗的消耗性配额比 [0,1]；无消耗性池 → 0 */
  usedRatio: number;
}

export interface WindowRefundResult {
  paid: number;
  alpha: number;
  usedRatio: number;
  /** 退客户（元，两位小数） */
  amount: number;
  /** 平台留下的那一份（元）= paid − amount，只因为配额被消耗掉了 */
  kept: number;
  /** 是否全额（用于 refund_type：全额 normal / 少于实付 partial） */
  full: boolean;
}

/**
 * 退款窗口内的折算退。**与升级折抵是同一个公式**（`computeProration`），只是 `r` 取 1：
 *
 *     refund = round2( paid × ((1−α)·1 + α·u) ) = round2( paid × (1 − α·used) )
 *
 * 为什么 `r = 1`：退款窗口（默认 24 小时）恰好就是「刚买、几乎没用」那段时间，按天扣它
 * 没有意义。原样代入 `r = daysLeft / daysTotal` 的话，买了 2 小时就退的月付单
 * `daysLeft` 向下取整 = 29，`r = 29/30`——**全额退变成退 96.7%**，是对 owner 现行口径
 * （24h 全额退）的回退，客户一定会问那 3.3% 去哪了。
 *
 * 所以这个函数只做一件事：把**消耗掉的配额那一份**留下，其余退回。
 *   · 无消耗性池 / 一点没用 → used = 0 → 全额退（与今天一致）
 *   · α = 1（价值全在配额里）且用光 → 退 0，此时不该开退款单（调用方判）
 *
 * 超出窗口不退，那一档不走这里（资格检查先拦）。
 */
export function computeWindowRefund(
  input: WindowRefundInput,
): WindowRefundResult {
  const paid = round2(Math.max(0, input.paid));
  const alpha = clamp01(input.alpha);
  const usedRatio = clamp01(input.usedRatio);
  const amount = round2(paid * (1 - alpha * usedRatio));
  return {
    paid,
    alpha,
    usedRatio: Math.round(usedRatio * 10000) / 10000,
    amount,
    kept: round2(paid - amount),
    full: amount >= paid,
  };
}
