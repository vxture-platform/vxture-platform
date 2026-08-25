/* intl.ts — admin 的消息目录出口（服务端）。
 *
 * 与 `portals/opera/src/lib/intl.ts` 同形，理由完整写在那一份的头注里：无路由
 * 模式（URL 不变，语言由 `NEXT_LOCALE` cookie 决定），判定链复用
 * `@vxture/core-locale` 的 `resolveLocale()`，两本静态 import 是有意的。
 *
 * ## 它替掉了什么
 *
 * admin 此前用自搓的 `lib/ConsoleIntl.tsx` + `lib/i18n.ts`：一个 React context、
 * 一个 `t(key, fallback?, values?)`、`{name}` 简单替换。够用，但接不住三样东西——
 * ICU 复数（中文没有复数形式，所以这个缺口只在英文上真起来的那天现形：
 * 「1 models」）、日期与数字的按语言格式化、以及 `t()` 的键类型检查。
 *
 * 平台上本来就有两个门户（console / website）在用 next-intl，再养一套手搓的，
 * 差异只能由历史解释。现在统一成一个库、两种配置，差异由「要不要 SEO」解释。
 */

import { resolveLocale } from "@vxture/core-locale";
import type { Locale } from "@vxture-platform/shared";
import enUS from "../../messages/en-US.json";
import zhCN from "../../messages/zh-CN.json";

/** 词条形状以中文本为准：中文是原文，英文本必须与它逐键对齐（守卫在管）。 */
export type AdminMessages = typeof zhCN;

const CATALOG: Record<Locale, AdminMessages> = {
  "zh-CN": zhCN,
  /* 断言而不是让 TS 结构比对：两本的差异要由
     `scripts/guardrails/check-message-catalogs.mjs` 报告（哪个键缺了、缺在哪本），
     不该表现为这一行上一坨读不懂的类型错误。 */
  "en-US": enUS as AdminMessages,
};

export function adminLocale(headers: Headers): Locale {
  return resolveLocale({ headers });
}

export function adminMessages(locale: Locale): AdminMessages {
  return CATALOG[locale] ?? CATALOG["zh-CN"];
}

/**
 * 缺键时的托底：**返回键路径，不抛异常。**
 *
 * next-intl 默认在缺键时抛（开发期）或渲染错误。admin 原来那套返回键名本身，
 * 于是缺一条词条的后果是界面上出现一串 `settings.foo.bar` ——难看，但页面还在。
 * 迁移这一步刻意保持后一种行为：一次机制替换不该顺带把一批「难看」变成「白屏」，
 * 尤其是在这个门户 116 个页面里只有 8 个接了 `t()` 的当下。
 *
 * 真正防缺键的是守卫（键必须与中文本逐一对齐，CI 上卡），不是运行时崩溃。
 */
export function adminMessageFallback({ key }: { key: string }): string {
  return key;
}
