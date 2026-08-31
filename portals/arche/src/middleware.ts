/**
 * middleware.ts —— arche 的认证前置闸。
 *
 * arche（平台治理平面）与 opera 同一套运维面拓扑：生产上 nginx 的 `auth_request`
 * 网关先于 Next 拦截每个请求（打到 arche-bff 的 `/auth/check`，204 放行 / 401 转
 * 登录），未认证请求到不了这里 —— 本文件在生产是恒真闸。真正吃这一层的是**开发
 * 环境**：那里没有边缘网关，靠它挡住整屏渲染→水合→401→replace 的老路。
 *
 * 判定逻辑与 admin/opera/console/website 共用 `@vxture/core-identity-sdk/edge`，
 * 不为任何门户开逃生口。治理面日后要更硬的鉴权姿态（常态 step-up），走 BFF 守卫，
 * 不在这道 edge 闸放宽。
 */

import { createAuthMiddleware } from "@vxture/core-identity-sdk/edge";

export const middleware = createAuthMiddleware({ app: "arche" });

export const config = {
  /* 负向匹配把静态资源挡在 middleware 之外（SDK 的豁免判断是第二道保险：
   * matcher 省的是调用开销，豁免判断保的是正确性）。 */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
