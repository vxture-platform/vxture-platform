"use client";

/**
 * use-date-format.ts — console 里日期时间的**唯一入口**。
 * @package @vxture/console
 * @layer Presentation
 * @category Lib
 *
 * ── 为什么是 hook,而不是纯函数 ──
 * 纯函数拿不到页面 locale。此前 `hubModel.ts` 里那三个手拼函数就是这样:
 * 不看语言,英文界面下照样输出 `2026-09-10`;`fmtTime` 还漏了秒,
 * 而规范原话是「显示时间就必须带秒——两个 `15:04` 摆在一起看不出谁先谁后」。
 *
 * next-intl 的 `useFormatter()` 解决的正是这三件:
 *   · **语言一致** —— 它拿的是页面 locale,由构造保证,不靠调用方传对;
 *   · **形态一致** —— 形态定义在 `i18n/formats.ts`(规范的四种组合),不在调用点;
 *   · **不重复构造** —— Intl 实例由 next-intl 缓存(构造比 format 贵 77 倍,实测)。
 *
 * ── 空值一律给「—」 ──
 * 与旧的 `fmtDate` 同口径:没有值时给一个占位符,而不是空白——空白读起来像
 * 「这一格没加载出来」。
 */
import { useFormatter } from "next-intl";
import { useMemo } from "react";

/** 没有值时的占位。与 DS 表格里的空值口径一致。 */
const EMPTY = "—";

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface DateFormatters {
  /** 长日期:`2026/09/10`(字段顺序随语言)。 */
  fmtDate: (value: string | number | Date | null | undefined) => string;
  /** 长时间(**含秒**):`22:05:09`。 */
  fmtTime: (value: string | number | Date | null | undefined) => string;
  /** 长日期 + 长时间:`2026/09/10 22:05:09`。日期与时间同时要显示时用它。 */
  fmtDateTime: (value: string | number | Date | null | undefined) => string;
  /** 短日期:`09/10`。**只**给宽度真的不够的地方(统计卡数值行)。 */
  fmtDateShort: (value: string | number | Date | null | undefined) => string;
}

export function useDateFormat(): DateFormatters {
  const format = useFormatter();
  return useMemo(() => {
    const make =
      (variant: "day" | "time" | "long" | "dayShort") =>
      (value: string | number | Date | null | undefined) => {
        const d = toDate(value);
        return d ? format.dateTime(d, variant) : EMPTY;
      };
    return {
      fmtDate: make("day"),
      fmtTime: make("time"),
      fmtDateTime: make("long"),
      fmtDateShort: make("dayShort"),
    };
  }, [format]);
}
