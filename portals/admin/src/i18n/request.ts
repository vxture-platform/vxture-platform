/* request.ts — next-intl 的服务端请求配置。
 *
 * ## 为什么必须有这个文件
 *
 * 无路由模式看起来只需要在 layout 里给 `NextIntlClientProvider` 传 locale 和
 * messages，但 next-intl 从 server component 里被引用时**一定**会去找这份配置，
 * 找不到就抛：
 *
 *     Couldn't find next-intl config file.
 *
 * 而这件事 `next build` 抓不到：根 layout 调了 `headers()`，于是所有路由都变成
 * 动态渲染，build 期根本不渲染它们——build 全绿（46 页），一发请求就 500。
 * `type-check` 更看不见。是把栈跑起来打开页面才现形的。
 *
 * ## 它和 layout 里那份是什么关系
 *
 * 这份是**权威**：`getTranslations()`（server component 用）和
 * `NextIntlClientProvider` 的默认值都从它取。layout 里仍然显式传一次 locale 与
 * messages，因为 `<html lang>` 也要用同一个 locale——让两处读同一个函数，比让
 * layout 去猜 provider 拿到了什么可靠。
 */

import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";
import { adminLocale, adminMessages } from "@/lib/intl";

export default getRequestConfig(async () => {
  const locale = adminLocale(await headers());
  return { locale, messages: adminMessages(locale) };
});
