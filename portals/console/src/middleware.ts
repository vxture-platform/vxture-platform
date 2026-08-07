/**
 * middleware.ts —— console 的认证前置闸 + i18n 路由。
 *
 * 三态机（判定、cookie 契约、静默探测时机）在 `@vxture/core-identity-sdk/edge`，
 * 与 admin 共用同一份实现。console 这里只剩自己的三件事：**我是哪个 app**、
 * **哪些路由不参与认证**、以及**认证之后交给 next-intl**。
 *
 * 认证排在 i18n 之前：认不过就没必要算 locale，且 locale 计算会重写 URL，
 * 之后再判认证就得处理"带没带前缀"两种形态。
 *
 * 注意：cookie 存在 ≠ session 有效（token 可能已过期）。刻意不在这里向 BFF 求证——
 * 那是一次阻塞每个请求的网络调用。失效态由 ConsoleShell 拿到 401 后兜底跳转，
 * 那是少数路径值得慢；首访是多数路径必须快。
 *
 * @package @vxture/console
 * @layer Presentation
 * @category Middleware
 */

import createMiddleware from "next-intl/middleware";
import { createAuthMiddleware } from "@vxture/core-identity-sdk/edge";
import { routing } from "./lib/i18n/routing";

const handleI18n = createMiddleware(routing);

/** 去除 locale 前缀，返回纯业务路径（如 /zh-CN/members → /members）。 */
function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
    if (pathname === `/${locale}`) return "/";
  }
  return pathname;
}

export const middleware = createAuthMiddleware({
  app: "console",
  /* `/signin` 现在只是个直连入口——middleware 不再把未认证的人**送进**它
   * （见下），但它仍可能被外部链接直接命中，所以继续豁免，否则就是自己跳自己。 */
  isExempt: (pathname) => stripLocale(pathname) === "/signin",
  onAllow: handleI18n,
});

/* 未认证时直接去 `/auth/login`，不再经 `/signin` 中转。
 *
 * `/signin` 是个纯跳板页：渲染一屏"正在跳转到登录…"，水合，然后在 effect 里
 * `location.assign` 去同一个 `/auth/login`。它给用户的是一次完整的页面加载 +
 * 一次绘制，换来的信息量为零——正是 admin 那边已经拆掉的 `/login`。
 * 文件保留（可能有外链），但认证链路不再穿过它。 */

export const config = {
  // 排除 api/* 与 auth/*（OIDC-RP 端点，生产经 nginx、本地经同源 rewrite shim
  // 代理到 console-bff）：它们**就是**认证流程本身，拦下来即死循环。
  matcher: ["/((?!api|auth|_next|.*\\..*).*)"],
};
