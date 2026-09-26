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
import { PLATFORM_TIME_ZONE } from "@vxture-platform/shared";

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

  /* 展示时区固定（owner 2026-09-26）：不配它时 SSR 按容器 UTC、客户端按浏览器，
     同一条数据在两个门户显示成不同的日子（实测差一天）。权威在 @shared。 */
  return {
    locale,
    messages,
    formats: DATETIME_FORMATS,
    timeZone: PLATFORM_TIME_ZONE,
  };
});
