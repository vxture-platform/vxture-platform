/**
 * quota-period.utils.ts — 配额周期的锚定推进（铁律五）
 * @package @vxture-platform/shared
 * @layer Domain
 * @category Utils
 *
 * ── 这是什么 ──
 * `data_commerce_200_metering.md` 的**铁律五**：订阅可在任意日开始，配额一律**锚定订阅
 * 周期**推进——15 号订即每月 15 号刷新，**不用日历自然月**。
 *
 * ── 为什么收在一处 ──
 * 2026-09-26 清点，这条判据当时住在**三处**，各自实现、都按日历月：
 *   ① `pg-consume.repository.ts` 的 `needsReset` + 归零 SQL（**写入方**）
 *   ② `bff/platform-api` `entitlement-view.ts` 的 `needsReset`（读时投影）
 *   ③ `pg-metering-read.repository.ts` 的 `effective_used` case 表达式（读时投影，SQL）
 * 三份都对「现在算第几个周期」有自己的说法。一处改了另两处不会报错——只会让同一个池在
 * 消费接口、权益接口、用量接口上显示三个不同的余量。所以算式只留这一份，SQL 那处改成
 * 读原值、由调用方拿这里的函数算。
 *
 * ── 口径：UTC ──
 * 锚点是个**时刻**（订阅 start_at），按 UTC 推进，与库里 timestamptz 的存储口径一致。
 * 这跟「界面按 Asia/Shanghai 显示」（`PLATFORM_TIME_ZONE`）是两件事：一个是周期什么时候
 * 翻篇，一个是把时刻写给人看成哪一天。
 *
 * ── 月末夹取 ──
 * 31 号锚定的池，2 月没有 31 号 → 落当月最后一天；**但 3 月仍回到 31 号**。所以每一步都
 * 从**原始锚点**加 k 个月算，不是在上一次的结果上再加一个月（后者会把 31 号永久拖成 28 号）。
 */

/** `quota_pools.reset_period` 的值域（chk_quota_pools_reset_period）。 */
export type QuotaResetPeriod = "none" | "day" | "month";

const DAY_MS = 86_400_000;

/** 保留时刻、按目标月份天数夹取日期的「加 N 个月」（UTC）。 */
function addUtcMonths(base: Date, months: number): Date {
  const absMonth = base.getUTCMonth() + months;
  const year = base.getUTCFullYear() + Math.floor(absMonth / 12);
  const month = ((absMonth % 12) + 12) % 12;
  /* 目标月天数：下个月的第 0 天 = 本月最后一天。 */
  const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(base.getUTCDate(), daysInTarget),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
}

/**
 * 当前周期的起点 = `anchor + k×period` 中**最后一个 ≤ now** 的（k ≥ 0）。
 *
 * `now` 早于锚点时返回锚点本身：那是「第一个周期还没走完」，不是「倒着推了一个周期」。
 * 长期没被消费的池会直接跳到当前那一格，不是一格一格补——补出来的中间周期没有任何人
 * 用过，落 `quota_pool_resets` 只会污染台账。
 */
export function anchoredPeriodStart(
  anchor: Date,
  resetPeriod: QuotaResetPeriod,
  now: Date,
): Date {
  if (resetPeriod === "none") return anchor;
  if (now.getTime() <= anchor.getTime()) return anchor;

  if (resetPeriod === "day") {
    const k = Math.floor((now.getTime() - anchor.getTime()) / DAY_MS);
    return new Date(anchor.getTime() + k * DAY_MS);
  }

  let k =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchor.getUTCMonth());
  if (k < 0) k = 0;
  let candidate = addUtcMonths(anchor, k);
  /* 日历月差算多了一格的情形：锚点 9/15、现在 10/03 → k=1 得 10/15 > now，退一格到 9/15。 */
  while (k > 0 && candidate.getTime() > now.getTime()) {
    k -= 1;
    candidate = addUtcMonths(anchor, k);
  }
  return candidate;
}

/**
 * 这个池存着的 `current_period_start` 是不是已经翻篇了（该归零）。
 *
 * `periodAnchor` 缺失时退回拿 `currentPeriodStart` 当锚点：存量池若没补上锚点，行为等价
 * 于「从上一次归零处按周期推进」——不会比改之前更差，也不会静默按日历走。两个都没有
 * ⇒ 这个池从没初始化过，该归零。
 */
export function needsQuotaReset(input: {
  resetPeriod: string;
  periodAnchor: Date | null;
  currentPeriodStart: Date | null;
  now?: Date;
}): boolean {
  if (input.resetPeriod === "none") return false;
  if (input.currentPeriodStart === null) return true;
  const anchor = input.periodAnchor ?? input.currentPeriodStart;
  const now = input.now ?? new Date();
  const boundary = anchoredPeriodStart(
    anchor,
    input.resetPeriod as QuotaResetPeriod,
    now,
  );
  return input.currentPeriodStart.getTime() < boundary.getTime();
}
