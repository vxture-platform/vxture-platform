/**
 * format.utils.ts - Shared format utility functions
 * @package @vxture-platform/shared
 * @description Number, date, and currency formatting functions based on locale, supporting automatic or manual currency specification.
 */

import type { Locale } from "../types/locale.types";
import { LOCALE_DEFAULT_CURRENCY } from "../constants/locale.constants";

/**
 * 格式化货币
 * @param amount 金额
 * @param locale 语言（完整 BCP47 标签）
 * @param currency 货币代码（可选，默认按 locale 推断）
 * @param options 透传 Intl.NumberFormat 选项（如营销价整数展示的
 *   minimum/maximumFractionDigits），覆盖默认 currency 样式之外的细节
 */
export function formatCurrency(
  amount: number,
  locale: Locale,
  currency?: string,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    const resolvedCurrency = currency ?? LOCALE_DEFAULT_CURRENCY[locale];
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: resolvedCurrency,
      ...options,
    }).format(amount);
  } catch {
    return String(amount);
  }
}

/**
 * ── 日期与时间的形态规范（owner 2026-09-08）──
 *
 * 日期分长短、时间也分长短，四种组合规范上都支持：
 *
 *   长日期 `2026/09/08`   短日期 `09/08`
 *   长时间 `15:04:05`     短时间 `15:04`
 *
 * **平台当前统一采用「长日期 + 长时间」。** 「显示时间就必须带秒」正是从这里来的
 * ——长时间本就含秒；排查订单、审计、通知时，同一分钟内的先后顺序恰恰最要紧，
 * 两个「15:04」摆在一起看不出谁先谁后。
 *
 * 短形态保留在规范里（窄列、图表轴标这类地方用得上），但**不要临时手搓**：
 * 要用就从这里取，否则又会长回 2026-09-08 清点到的那四种各自漂移的写法
 * （`年月日 时分秒` / `月日 时分秒` / 裸 toLocaleString 不补零 / dateStyle 三种组合）。
 *
 * **字段顺序交给 locale，不写死**：日期的字段顺序属于语言——中文 `2026/09/08`，
 * 英文 `09/08/2026`。同一串数字，读出来是两个日期。所以走 Intl 而不是手拼。
 */
export type DateVariant = "long" | "short";

const DATE_STYLES = {
  long: { year: "numeric", month: "2-digit", day: "2-digit" },
  short: { month: "2-digit", day: "2-digit" },
} as const satisfies Record<DateVariant, Intl.DateTimeFormatOptions>;

const TIME_STYLES = {
  long: {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  },
  short: { hour: "2-digit", minute: "2-digit", hour12: false },
} as const satisfies Record<DateVariant, Intl.DateTimeFormatOptions>;

/** 接受调用方手上常见的几种形态；空值与非法值都落到 fallback。 */
export type DateInput = string | number | Date | null | undefined;

export interface DateFormatOptions {
  /** 日期形态，默认长日期（平台当前口径）。 */
  date?: DateVariant;
  /** 时间形态，默认长时间（含秒；平台当前口径）。仅 formatDateTime 有意义。 */
  time?: DateVariant;
  /** 固定时区。计量窗口按 UTC、邮件按发信方时区，这类场合才传。 */
  timeZone?: string;
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function render(
  d: Date,
  locale: string | undefined,
  opts: Intl.DateTimeFormatOptions,
  onError: () => string,
): string {
  try {
    return new Intl.DateTimeFormat(locale, opts).format(d);
  } catch {
    return onError();
  }
}

/**
 * 只有日期，不带时刻。用于注册日期、加入日期这类不需要时刻的场合——
 * 给它们加时分秒是另一种难看。
 */
export function formatDay(
  value: DateInput,
  /** 省略即交给运行时默认 locale——Intl 收 undefined 就是这个语义。 */
  locale: string | undefined,
  fallback = "—",
  opts: DateFormatOptions = {},
): string {
  const d = toDate(value);
  if (!d) return fallback;
  return render(
    d,
    locale,
    {
      ...DATE_STYLES[opts.date ?? "long"],
      ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
    },
    () => d.toISOString().slice(0, 10),
  );
}

/** 日期 + 时刻。默认长日期 + 长时间（含秒），即平台当前统一口径。 */
export function formatDateTime(
  value: DateInput,
  /** 省略即交给运行时默认 locale——Intl 收 undefined 就是这个语义。 */
  locale: string | undefined,
  fallback = "—",
  opts: DateFormatOptions = {},
): string {
  const d = toDate(value);
  if (!d) return fallback;
  return render(
    d,
    locale,
    {
      ...DATE_STYLES[opts.date ?? "long"],
      ...TIME_STYLES[opts.time ?? "long"],
      ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
    },
    () => d.toISOString(),
  );
}

/**
 * @deprecated 用 {@link formatDay}（只有日期）或 {@link formatDateTime}
 * （日期 + 时刻）。本函数走的是无选项的 locale 默认形态，年月日不补零，
 * 与规范里的任一形态都对不上。保留仅为不破坏外部调用；仓内已无调用点。
 */
export function formatDate(date: Date, locale: Locale): string {
  return formatDay(date, locale);
}

export function formatNumber(value: number, locale: Locale): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return String(value);
  }
}
