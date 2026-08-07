/**
 * middleware.ts —— opera 的认证前置闸。
 *
 * opera 的拓扑与另外三个门户不同，值得说清楚它**为什么仍然需要这一层**：
 *
 * 生产上 nginx 的 `auth_request` 网关先于 Next 拦截每个请求（打到 opera-bff 的
 * `/auth/check`，204 放行 / 401 转登录），所以未认证的请求根本到不了这里 —— 本文件
 * 在生产是一道恒真的闸。真正吃这一层的是**开发环境**：那里没有边缘网关，此前
 * opera 走的就是"整屏渲染 → 水合 → fetch /auth/session → 401 → location.replace"
 * 那条老路，也就是三态机要消灭的 9 跳 3 绘制。
 *
 * 判定逻辑本身与 admin/console/website 共用 `@vxture/core-identity-sdk/edge`，
 * 这里没有为 opera 的拓扑开任何逃生口——一个门户"生产上另有网关"不构成放宽契约的
 * 理由，它只是让这道闸在生产恒真而已。
 *
 * SessionProvider 里的 401 跳转分支保留：会话在标签页开着时过期仍需兜底，
 * 那是少数路径，值得慢。
 */

import { createAuthMiddleware } from "@vxture/core-identity-sdk/edge";

export const middleware = createAuthMiddleware({ app: "opera" });

export const config = {
  /* 负向匹配把静态资源挡在 middleware 之外（SDK 的豁免判断是第二道保险：
   * matcher 省的是调用开销，豁免判断保的是正确性）。 */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
