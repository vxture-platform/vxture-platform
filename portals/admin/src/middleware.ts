/**
 * middleware.ts —— admin 的认证前置闸。
 *
 * 三态机本身（判定、cookie 契约、静默探测的时机）已经沉淀进
 * `@vxture/core-identity-sdk/edge`——那是四个门户共用的部分，admin 这里只剩自己的
 * 两件事：**我是哪个 app**，以及**哪些路由不参与认证**。新增第 N 个门户时要写的
 * 也就是这两行，不需要再来一轮登录优化。
 *
 * 为什么值得有这一层：它让**HTML 发出去之前身份状态就已经定了**。此前决策在客户端
 * 做——整屏渲染、水合、发会话请求、拿 401、再跳走，每次往返都是一次完整加载 + 一次
 * 绘制（2026-08-04 实测冷启动 9 跳 3 绘制）。跳转次数只是表象，根因是决策太晚。
 */

import { createAuthMiddleware } from "@vxture/core-identity-sdk/edge";

export const middleware = createAuthMiddleware({
  app: "admin",
  /* SDK 默认已豁免 `/auth/*`（RP 端点自己，拦它就是自己跳自己）、`/api/*`、
   * `/_next/*` 与带扩展名的静态资源。这里只补 admin 独有的两项：
   * `/varda/` 是内嵌助手的自有路由，`/login` 是历史中转页（它自己就负责跳登录）。 */
  isExempt: (pathname) =>
    pathname.startsWith("/varda/") || pathname === "/login",
});

export const config = {
  /* 负向匹配把静态资源挡在 middleware 之外（SDK 里的豁免判断是第二道保险，
   * 两者都留着：matcher 省的是调用开销，豁免判断保的是正确性）。 */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
