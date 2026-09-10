/**
 * date-format.ts — 官网营销版式的日期形态，**唯一出口**。
 * @package @vxture/website
 * @layer Presentation
 * @category Lib
 *
 * ── 为什么 website 不直接用共用件 ──
 * 平台统一口径是「长日期 + 长时间」（`@vxture-platform/shared` 的 format.utils，
 * console 侧走 `useDateFormat()`）。营销卡要的是另一回事：一格里只放年月、
 * 或者年月日不补零，宽度和版式是设计决定的。把它们塞进平台口径会得到
 * `2024/03/01 00:00:00`，那不是这些卡想要的。
 *
 * ── 但「不用共用件」不等于「自己拼日期」 ──
 * **字段顺序属于语言**：中文年在前、英文月在前。所以顺序一律由 Intl 决定，
 * 这里只管排版（分隔符、补零）。手拼 `${y}/${m}` 那种写法把中文顺序写死了，
 * 英文访客拿到的也是中文序——2026-09-10 的案例卡就是这么错的。
 *
 * ── 为什么收到这一个文件 ──
 * `lint:datetime-discipline` §1 禁止各处手搓 Intl；此前 `ProductCatalogCard.tsx`
 * 单独占一条豁免，案例卡改完就要占第二条。豁免按组件增长意味着这条判据会
 * 一路失效。收到这里，只豁免一个文件，新增形态往这里加。
 */
import { useLocale } from "next-intl";
import { useMemo } from "react";

/** locale + 形态 → Intl 实例。构造比 format 贵约 77 倍（实测），只建一次。 */
const CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(
  locale: string,
  key: string,
  opts: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const id = `${locale}|${key}`;
  let f = CACHE.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts);
    CACHE.set(id, f);
  }
  return f;
}

function toDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 紧凑年月，**月份补零**：`2024/03`（中文）/ `03/2024`（英文）。
 *
 * 用 formatToParts 而不是 format：`Intl.format` 在 zh-CN 下给的是 `2024年3月`——
 * 与卡片版式不搭，**而且不补零**（zh-CN 在「年+月」这个组合下不认
 * `month: "2-digit"`），三张并排的卡宽度会参差。
 * 顺序仍然来自 Intl，这里只补零和换分隔符。
 */
export function formatYearMonth(iso: string, locale: string): string {
  const d = toDate(iso);
  if (!d) return "";
  return formatter(locale, "ym", { year: "numeric", month: "2-digit" })
    .formatToParts(d)
    .filter((p) => p.type === "year" || p.type === "month")
    .map((p) => (p.type === "month" ? p.value.padStart(2, "0") : p.value))
    .join("/");
}

/**
 * 年月日，**按 locale 的数字格式、不补零**：`2026/9/12`（中文）/ `9/12/2026`（英文）。
 * 产品目录卡的「v1.2.3 at …」与「预期发布：…」用它（owner 2026-09-03 定的版式）。
 */
export function formatNumericDate(iso: string, locale: string): string {
  const d = toDate(iso);
  if (!d) return "";
  return formatter(locale, "ymd", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(d);
}

/** 组件里的取用口：locale 由 next-intl 带，不靠调用方传对。 */
export function useWebsiteDateFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      /** `2024/03` —— 紧凑年月，月份补零。 */
      yearMonth: (iso: string) => formatYearMonth(iso, locale),
      /** `2026/9/12` —— 年月日，不补零。 */
      numericDate: (iso: string) => formatNumericDate(iso, locale),
    }),
    [locale],
  );
}
