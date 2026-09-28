/**
 * notice-filters.ts — 四项读侧筛选参数的**唯一**解析处，连同 ILIKE 的转义。
 * @package @vxture/service-notice
 * @layer Domain
 * @category Parsing
 *
 * ── 为什么这一份要存在 ──
 * `severity` / `source` / `unread` / `q` 这四个查询参数名此前在 admin-bff 与 opera-bff
 * 各解析一份。名字是逐字相同的（opera 的路由注释还明说了「同一件事在两个平面该叫同一个
 * 词，否则接第三个平面的人只能靠读两份代码猜哪个对」），**值的词汇却分岔成了三处**：
 *
 *   · `unread=1`        opera 开这一档，admin 静默忽略；
 *   · `severity=all`    opera 读作「不筛」，admin 回 400；`source=all` 同；
 *   · `q` 的上限        opera 超 128 就 400，admin 到 200 才 400。
 *
 * 于是同一个 URL 在两个平面上是两种行为，而这三处分岔没有一条会在类型上报错。
 * 被复制的那一半（`likePattern`）反倒一直一致——它逐字节抄了两份，两份都没人改过。
 * 「复制得没走样」不是判据：走样的恰恰是没人去复制、各自后加的校验那一半。
 *
 * ── 定下来的词汇（要改就改这里，不许在某一侧再长一条分支）──
 *
 *   开关类（`unread`，以及 opera 发布面的 `includeExpired`）
 *       `"true"` 与 `"1"` 都开，其余一律当没开，**不抛**：一个筛选开关拼错不该让整页
 *       读不出来。取两侧的并集——admin 原本只认 `"true"`，而前端有的地方送 1，那种
 *       失效的症状是「筛了但没筛」，和「筛出来很多条」长得一样。
 *
 *   `severity` / `source`
 *       `"all"` 与空串 = 不筛（下拉框的「全部」送的就是这个值，为它回 400 只会逼前端
 *       在每一处各写一遍「全部要记得别送」）。**不认识的值抛**，并点名出错的字段——
 *       这是 admin 那一半，保留它：静默忽略会让人看着一页没筛过的数据以为筛过了，而
 *       筛选器最坏的失败不是报错，是报成功而没筛。
 *
 *   `q`（关键词）
 *       上限 200 字，取两个上限里**大的那个**。收窄到 128 会让 admin 上原本成功的一次
 *       150 字搜索开始回 400——统一词汇不该把跑得通的调用改成错。只有空白 = 不筛，
 *       不是一条错：在搜索框里按一下空格，整页变「读取失败」是没人能解释的。
 *
 * ── 错误不在这里翻成 HTTP ──
 * 本包不认识 Nest 的异常，也不该认识：两个 BFF 的封套本来就不是一个（admin 抛
 * `BadRequestException`，opera 抛带 `code` / `field` 的 `ApiError`）。所以这里只抛
 * `NoticeFilterError`，各自的路由把它翻成自己那一种 400——HTTP 关切留在 BFF，值的
 * 词汇留在这一份。
 */

import { NOTICE_SEVERITIES } from "../types/notice.types";
import type {
  NoticeFilters,
  NoticeSeverity,
  NoticeSource,
} from "../types/notice.types";

/** 关键词上限。超了不截断而是 400——悄悄截一半会让「搜不到」变得无法解释。 */
export const NOTICE_KEYWORD_MAX = 200;

/**
 * 「不筛」的两种写法：空串与 `all`。
 *
 * 两者都要认：空串是「参数在但没填」（表单序列化常这样），`all` 是下拉框「全部」那一项
 * 的值。只认一种的那一侧会为另一种回 400，而那一格在界面上正是默认值。
 */
const NO_FILTER_TOKENS = new Set(["", "all"]);

/** 出错的那一格。名字与线上参数名同一套，控制台靠它高亮。 */
export type NoticeFilterField = "severity" | "source" | "keyword";

/**
 * 解析失败。`code` 取 opera 封套那两个校验码，admin 只用 `message`——
 * 两侧翻译各取所需，本包不替谁决定状态码。
 */
export type NoticeFilterErrorCode =
  | "VALIDATION_INVALID_VALUE"
  | "VALIDATION_TOO_LONG";

/**
 * 认不出的筛选值。**必须是 400 且点名字段**，不许被谁 catch 成「当没给」：
 * 那一步会把「写错的词」变成「返回全部」，而调用方以为自己筛过了。
 */
export class NoticeFilterError extends Error {
  constructor(
    readonly code: NoticeFilterErrorCode,
    message: string,
    readonly field: NoticeFilterField,
  ) {
    super(message);
    this.name = "NoticeFilterError";
  }
}

/** 查询串原样（值都是字符串或字符串数组）。重复给的参数由 express 变成数组。 */
export interface NoticeFilterQuery {
  readonly severity?: string | readonly string[] | undefined;
  readonly source?: string | undefined;
  readonly unread?: string | undefined;
  readonly q?: string | undefined;
}

/**
 * 开关类参数。`"true"` 与 `"1"` 都认，其余当没开，**不抛**。见文件头的词汇表。
 */
export function parseNoticeFlag(raw: string | undefined): boolean {
  return raw === "true" || raw === "1";
}

/**
 * 严重度。可以重复给（`severity=info&severity=warning`）也可以逗号分隔，两种写法
 * 同一个口径。空串与 `all` 是「不筛」；不认识的值抛并点名 `severity`。
 *
 * 三档全给收敛成空数组（= 不筛）：`counts` 那排数字算在「除严重度以外都筛过」的集合
 * 上，两种表示各存一份的话，同一屏会算出两排不同的数。
 */
export function parseNoticeSeverities(
  raw: string | readonly string[] | undefined,
): NoticeSeverity[] {
  if (raw === undefined) return [];
  const given = typeof raw === "string" ? [raw] : raw;
  const parts = given
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => !NO_FILTER_TOKENS.has(value));

  const out: NoticeSeverity[] = [];
  for (const part of parts) {
    if (!(NOTICE_SEVERITIES as readonly string[]).includes(part)) {
      throw new NoticeFilterError(
        "VALIDATION_INVALID_VALUE",
        `severity must be one of ${NOTICE_SEVERITIES.join("/")}`,
        "severity",
      );
    }
    // 去重：`severity=info,info` 会让 `= any()` 多扫一遍，结果一样但没必要。
    if (!out.includes(part as NoticeSeverity)) out.push(part as NoticeSeverity);
  }
  return out.length === NOTICE_SEVERITIES.length ? [] : out;
}

/** 来源。空串 / `all` = 不筛（回 `null`）；别的词抛并点名 `source`。 */
export function parseNoticeSource(
  raw: string | undefined,
): NoticeSource | null {
  const value = raw?.trim() ?? "";
  if (NO_FILTER_TOKENS.has(value)) return null;
  if (value !== "manual" && value !== "system") {
    throw new NoticeFilterError(
      "VALIDATION_INVALID_VALUE",
      "source must be manual or system",
      "source",
    );
  }
  return value;
}

/**
 * 关键词。两侧空白剪掉；**只有空白 = 不筛，不是一条错**；超 200 字抛并点名 `keyword`。
 *
 * 刻意不走各 BFF 的「必填/可选字段」帮手：那些对「trim 完是空」抛 VALIDATION_REQUIRED，
 * 而这是个筛选框，不是一个字段。
 */
export function parseNoticeKeyword(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (trimmed === "") return "";
  if (trimmed.length > NOTICE_KEYWORD_MAX) {
    throw new NoticeFilterError(
      "VALIDATION_TOO_LONG",
      `keyword must be at most ${NOTICE_KEYWORD_MAX} characters`,
      "keyword",
    );
  }
  return trimmed;
}

/**
 * 四项一起解析成 `NoticeFilters`。**不给的那一项不出现在返回对象里**——
 * 返回 `{ severities: undefined }` 与不返回它在类型上等价（exactOptionalPropertyTypes
 * 下前者还不合法），但在 `buildListQuery` 那一侧会多长一种「给了一个空值」的形状。
 *
 * 发布面另有一个 `includeExpired`，它不是读侧筛选（它换的是数据集，不是少看几行），
 * 所以不在这里——opera 用 `parseNoticeFlag` 单独解析它，词汇仍是同一套。
 */
export function parseNoticeFilters(raw: NoticeFilterQuery): NoticeFilters {
  const severities = parseNoticeSeverities(raw.severity);
  const source = parseNoticeSource(raw.source);
  const unreadOnly = parseNoticeFlag(raw.unread);
  const keyword = parseNoticeKeyword(raw.q);

  return {
    ...(severities.length > 0 ? { severities } : {}),
    ...(source !== null ? { source } : {}),
    ...(unreadOnly ? { unreadOnly: true } : {}),
    ...(keyword !== "" ? { keyword } : {}),
  };
}

/**
 * ILIKE 的通配符转义——**只有这一份**（此前 opera 的路由里逐字节抄了第二份）。
 *
 * 绑定参数挡得住注入，挡不住语义：运营者搜「100%」时 `%` 是他要找的那个字符，不是
 * 「随便多少个字」。`\` 也要转，否则搜一个反斜杠会把后面那个字吃掉。
 */
export function likePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
