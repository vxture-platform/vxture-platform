/**
 * next-intl 服务端请求配置 — 按 locale 加载消息文件
 *
 * @package @vxture/console
 * @layer Presentation
 * @category I18n
 * @author AI-Generated
 * @date 2026-05-05
 */

import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import { DATETIME_FORMATS } from "./formats";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  if (!locale || !(routing.locales as readonly string[]).includes(locale)) {
    locale = routing.defaultLocale;
  }

  const messages =
    locale === "en-US"
      ? ((await import("@/../messages/en-US.json")).default as Record<
          string,
          unknown
        >)
      : ((await import("@/../messages/zh-CN.json")).default as Record<
          string,
          unknown
        >);

  return { locale, messages, formats: DATETIME_FORMATS };
});
