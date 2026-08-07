/**
 * next-middleware.ts —— 把三态判定接到 Next 的 Edge middleware 上。
 *
 * 这一层的意义是：**HTML 发出去之前身份状态就已经定了**。此前决策发生在客户端——
 * 页面先整屏渲染、水合、发一次会话请求、拿到 401、再 `location.replace` 跳走，
 * 每一次往返都是一次完整加载 + 一次绘制（2026-08-04 实测冷启动 9 跳 3 绘制）。
 * 跳转次数只是表象，根因是**决策发生得太晚**。
 *
 * 只 import `next/server`，不碰 ioredis / pg / node 内建——Edge runtime 下那些包
 * 会在**构建期**就炸，而不是运行期给你一个能看的错误。SDK 因此分成两个入口，
 * 本文件只出现在 `@vxture/core-identity-sdk/edge` 里。
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  presenceCookieName,
  rpSessionCookieNames,
  SILENT_FAILED_PARAM,
} from "./cookies";
import { decideAuth } from "./decide";

/**
 * 默认豁免路径。
 *
 * `/auth/*` 是 RP 端点自己（本地经 next.config 的 shim 代理到 BFF，生产由 nginx
 * 反代）——放进决策就是自己跳自己的死循环。其余是静态资源与 Next 内部路径，
 * 没有身份含义，拦下来只是白白加一层。
 *
 * 各门户还有自己的豁免项（admin 的 `/varda/`、console/website 的 `/signin`），
 * 通过 `isExempt` 追加，不塞进这里——SDK 不该知道任何一个门户的路由表。
 */
export function isDefaultExempt(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\.[a-z0-9]+$/i.test(pathname) // 带扩展名的一律当静态资源
  );
}

export interface AuthMiddlewareOptions {
  /** OIDC client id（admin / console / opera / website）——决定 cookie 名。 */
  app: string;
  /**
   * 门户自己的豁免判断，**追加**在默认豁免之上（默认那批总是豁免）。
   * 这是「登录后去哪页、哪些路由是公开的」这类归门户的知识的出口。
   */
  isExempt?: (pathname: string) => boolean;
  /** RP 登录入口，同源相对路径。默认 `/auth/login`。 */
  loginPath?: string;
  /**
   * **放行时**做什么——认证通过与豁免路径**都**走这里。默认 `NextResponse.next()`；
   * console/website 在这里接 next-intl，让 locale 处理排在认证之后（认证不通过就
   * 没必要算 locale）。
   *
   * 豁免也必须经过它：豁免的含义是"不参与认证决策"，不是"不参与后续处理"。
   * 少了这一条，website 的 `/` 会因为不需要认证而绕过 next-intl，直接 404
   * ——没有任何一处报错指向 middleware（2026-08-05 实测踩到）。
   */
  onAllow?: (req: NextRequest) => NextResponse;
  /**
   * 未认证时去哪个登录入口。默认走 `loginPath` + `returnTo`。
   * console/website 目前跳的是自己的 `/{locale}/signin`，用这个口子表达，
   * 不必为了接 SDK 先改掉它们的登录页拓扑。
   */
  onUnauthenticated?: (
    req: NextRequest,
    decision: { prompt: "none" | undefined },
  ) => NextResponse;
}

/**
 * 造一个门户的认证 middleware。
 *
 * ```ts
 * export const middleware = createAuthMiddleware({ app: "admin" });
 * export const config = { matcher: [...] };
 * ```
 */
export function createAuthMiddleware(
  options: AuthMiddlewareOptions,
): (req: NextRequest) => NextResponse {
  const {
    app,
    isExempt,
    loginPath = "/auth/login",
    onAllow,
    onUnauthenticated,
  } = options;
  const allow = (req: NextRequest): NextResponse =>
    onAllow?.(req) ?? NextResponse.next();
  const sessionCookies = rpSessionCookieNames(app);
  const presence = presenceCookieName(app);

  return function authMiddleware(req: NextRequest): NextResponse {
    const { pathname } = req.nextUrl;
    /* 静态资源与 Next 内部路径连 `onAllow` 都不该进——它们没有 locale 语义，
     * 交给 next-intl 只会平白多一次改写。门户自己声明的豁免则要继续走 `allow`：
     * 那些是真实页面，只是不参与认证决策。 */
    if (isDefaultExempt(pathname)) return NextResponse.next();
    if (isExempt?.(pathname)) return allow(req);

    const decision = decideAuth({
      hasRpSession: sessionCookies.some((name) => req.cookies.has(name)),
      presenceCookie: req.cookies.get(presence)?.value,
      silentParam: req.nextUrl.searchParams.get(SILENT_FAILED_PARAM),
    });

    if (decision.action === "allow") return allow(req);
    if (onUnauthenticated) {
      return onUnauthenticated(req, { prompt: decision.prompt });
    }

    /* returnTo 里要去掉 vx_sso_silent——它是上一跳的产物，带着它绕回来只会让参数
     * 越滚越长（实测能在 returnTo 里套出好几层）。 */
    const target = req.nextUrl.clone();
    target.searchParams.delete(SILENT_FAILED_PARAM);

    /* 用同源相对路径：本地由 next.config 的 shim 代理到 BFF，生产由 nginx 反代，
     * 真实主机名不进代码。 */
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = loginPath;
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "returnTo",
      `${target.origin}${target.pathname}${target.search}`,
    );
    if (decision.prompt) loginUrl.searchParams.set("prompt", decision.prompt);

    return NextResponse.redirect(loginUrl);
  };
}
