/**
 * middleware.ts —— website 的认证前置闸 + i18n 路由。
 *
 * 与 admin/console 用同一份三态机（`@vxture/core-identity-sdk/edge`），但**默认相反**：
 * website 是公开站点，只有 `/dashboard` 需要认证，其余全部豁免。这个反转恰好是
 * SDK 通不通用的检验点——`isExempt` 表达得了"只保护一条路径"，就不需要为它开特例。
 *
 * 豁免不是省事，是必须：营销页对未登录访客做静默探测，等于给每个首次访问的人
 * 加一趟 IdP 往返，而他们本来就不该登录。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Infrastructure
 */

import createMiddleware from "next-intl/middleware";
import { createAuthMiddleware } from "@vxture/core-identity-sdk/edge";
import { routing } from "./lib/i18n/routing";

const intlMiddleware = createMiddleware(routing);

function stripLocalePrefix(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const [firstSegment, ...restSegments] = segments;

  if (
    firstSegment &&
    routing.locales.includes(firstSegment as (typeof routing.locales)[number])
  ) {
    return restSegments.length > 0 ? `/${restSegments.join("/")}` : "/";
  }

  return pathname;
}

export const middleware = createAuthMiddleware({
  app: "website",
  // 只有 /dashboard 参与认证；其余（含 /signin 自身）一律豁免。
  isExempt: (pathname) => !stripLocalePrefix(pathname).startsWith("/dashboard"),
  onAllow: intlMiddleware,
});

/* 未认证访问 /dashboard 时直接去 `/auth/login`，不再经 `/signin` 中转。
 *
 * `/signin` 是个纯跳板页：渲染一屏"正在跳转到登录…"，水合，然后 `location.assign`
 * 去同一个 `/auth/login`。它给用户的是一次完整页面加载 + 一次绘制，信息量为零。
 * 文件保留（首页等处可能有外链），但认证链路不再穿过它。
 *
 * 另注：仍然不拦截"已登录用户访问登录页"——cookie 在不代表 session 有效，
 * 那个判断要向 BFF 求证，不值得放在每个请求的关键路径上。 */

export const config = {
  matcher: [
    // 匹配所有路由，但排除 API 路由、OIDC-RP 路由(/auth/*)和静态资源。
    // /auth/* 是认证流本身（prod 经 nginx 反代到 website-bff），不可被门卫拦截。
    "/((?!api|auth|_next|.*\\..*).*)",
    // 匹配没有语言前缀的路由，以便重定向到默认语言
    "/",
    "/signin",
    "/login",
    "/signup",
    "/register",
    "/products",
    "/about",
    "/dashboard",
  ],
};
