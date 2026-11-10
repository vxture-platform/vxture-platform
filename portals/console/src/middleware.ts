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

import { NextResponse, type NextRequest } from "next/server";
import {
  LOCALE_CONSTANTS,
  SUPPORTED_LOCALES,
  type Locale,
} from "@vxture-platform/shared";
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

/*
 * 不参与认证的页面。
 *
 * `/signin` 现在只是个直连入口——middleware 不再把未认证的人**送进**它（见下），
 * 但它仍可能被外部链接直接命中，所以继续豁免，否则就是自己跳自己。
 *
 * `/native-done` 是桌面端登录的**终点页**，而它的前提正是**浏览器没有 console
 * 会话**：native 面的回调刻意不种 cookie（会话归应用，浏览器只做批准）。所以
 * 到达这一页的浏览器一定是未认证的——不豁免的话，刚登完的用户会被要求再登一次，
 * 而他真去登了就会在浏览器里留下一个设计上刻意避免的游荡会话。
 *
 * 判据不是「这一页需不需要数据」，是**到达它的浏览器有没有会话**。凡是某条认证
 * 流程的终点或跳板，答案都是「没有」。
 */
const EXEMPT_PAGES = new Set(["/signin", "/native-done"]);

export const middleware = createAuthMiddleware({
  app: "console",
  isExempt: (pathname) => EXEMPT_PAGES.has(stripLocale(pathname)),
  onAllow: (request: NextRequest) => {
    const hint = request.nextUrl.searchParams.get("vx_locale") as Locale;
    if (SUPPORTED_LOCALES.includes(hint)) {
      const target = request.nextUrl.clone();
      target.searchParams.delete("vx_locale");
      const prefix = target.pathname.split("/")[1] as Locale;
      if (SUPPORTED_LOCALES.includes(prefix))
        target.pathname = target.pathname.replace(`/${prefix}`, `/${hint}`);
      const response = NextResponse.redirect(target);
      const host = request.nextUrl.hostname;
      const domain =
        host === "vxture.com" || host.endsWith(".vxture.com")
          ? ".vxture.com"
          : undefined;
      response.cookies.set(LOCALE_CONSTANTS.COOKIE_KEY, hint, {
        path: "/",
        domain,
        sameSite: "lax",
        maxAge: 31536000,
        secure: request.nextUrl.protocol === "https:",
      });
      if (domain)
        response.headers.append(
          "Set-Cookie",
          `${LOCALE_CONSTANTS.COOKIE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`,
        );
      return response;
    }
    // A stale locale-prefixed link must not overwrite the shared platform choice.
    const saved = request.cookies.get(LOCALE_CONSTANTS.COOKIE_KEY)
      ?.value as Locale;
    const prefix = request.nextUrl.pathname.split("/")[1] as Locale;
    if (
      SUPPORTED_LOCALES.includes(saved) &&
      SUPPORTED_LOCALES.includes(prefix) &&
      prefix !== saved
    ) {
      const target = request.nextUrl.clone();
      target.pathname = target.pathname.replace(`/${prefix}`, `/${saved}`);
      return NextResponse.redirect(target);
    }
    return handleI18n(request);
  },
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
