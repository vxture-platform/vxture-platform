/* intl.ts — opera 的消息目录出口（服务端）。
 *
 * ## 为什么是「无路由模式」
 *
 * next-intl 有两种用法：带 `[locale]` 路由段（`/zh-CN/model/keys`），和只给
 * provider 传 locale + messages。console 与 website 用前者，因为它们是公开面、
 * 要让爬虫和分享出去的链接各自带语言。
 *
 * opera 是登录后的运维台：没有爬虫，链接只在内部传，而 `[locale]` 段的代价是
 * 把 51 个页面的路由整体挪一层。所以这里用后者——**URL 一个字都不改**，语言
 * 由 `NEXT_LOCALE` cookie 决定。差异从此由「要不要 SEO」解释，而不是由历史解释。
 *
 * ## locale 的判定不在这里
 *
 * 判定链（cookie → Cookie 头 → Accept-Language → 默认）早就在
 * `@vxture/core-locale` 的 `resolveLocale()` 里，全平台一份，BFF 也在用。
 * 这个文件只回答第二个问题：**这个 locale 对应哪一本词条**。
 *
 * ## 两本都静态 import，是有意的
 *
 * 动态 `import(\`../../messages/${locale}.json\`)` 看起来更省，但模板字面量让
 * 打包器分析不了，Next 会把整个目录打进去、或者干脆在 edge 上失败。两本静态
 * 引入进的是**服务端**包（服务端本来就要能渲染任一语言），而
 * `NextIntlClientProvider` 只把选中的那一本序列化给客户端——客户端拿到的仍然
 * 只有一份。
 */

import { resolveLocale } from "@vxture/core-locale";
import type { Locale } from "@vxture-platform/shared";
import enUS from "../../messages/en-US.json";
import zhCN from "../../messages/zh-CN.json";

/** 词条的形状以中文本为准：中文是原文，英文本必须与它逐键对齐。 */
export type ArcheMessages = typeof zhCN;

const CATALOG: Record<Locale, ArcheMessages> = {
  "zh-CN": zhCN,
  /* 断言而不是让 TS 结构比对：两本的差异要由守卫报告（哪个键缺了、缺在哪本），
     不该表现为这一行上一坨读不懂的类型错误。守卫见
     scripts/guardrails/check-message-catalogs.mjs。 */
  "en-US": enUS as ArcheMessages,
};

/**
 * 从请求头判定 locale。
 *
 * 收 `Headers` 而不是自己调 `next/headers`：这样它在 route handler、middleware、
 * 测试里都能用，且这个文件不必是 server-only。调用方（layout）自己去拿。
 */
export function archeLocale(headers: Headers): Locale {
  return resolveLocale({ headers });
}

export function archeMessages(locale: Locale): ArcheMessages {
  return CATALOG[locale] ?? CATALOG["zh-CN"];
}
