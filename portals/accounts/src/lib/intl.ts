/* intl.ts — accounts 的消息目录出口（服务端）。
 *
 * 与 opera / admin 那两份同形，理由完整写在 `portals/opera/src/lib/intl.ts` 的
 * 头注里。accounts 有一点不同值得写下来：
 *
 * **它是登录**前**的页面，所以 `Accept-Language` 才是主要来源。** opera / admin
 * 的访问者已经登录、有偏好，locale 基本来自 cookie；而 accounts 的访问者多半是
 * 第一次到达，身上没有任何偏好。`resolveLocale()` 的判定链
 * （cookie → Cookie 头 → Accept-Language → 默认）本来就覆盖这一段，所以这里
 * 什么都不用多做——但也因此，accounts 暂时不给语言开关：在登录页上让人先选
 * 语言再登录，是把浏览器已经说清楚的事又问一遍。
 */

import { resolveLocale } from "@vxture/core-locale";
import type { Locale } from "@vxture-platform/shared";
import enUS from "../../messages/en-US.json";
import zhCN from "../../messages/zh-CN.json";

export type AccountsMessages = typeof zhCN;

const CATALOG: Record<Locale, AccountsMessages> = {
  "zh-CN": zhCN,
  "en-US": enUS as AccountsMessages,
};

export function accountsLocale(headers: Headers): Locale {
  return resolveLocale({ headers });
}

export function accountsMessages(locale: Locale): AccountsMessages {
  return CATALOG[locale] ?? CATALOG["zh-CN"];
}
