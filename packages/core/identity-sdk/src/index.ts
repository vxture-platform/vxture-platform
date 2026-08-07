/**
 * index.ts —— @vxture/core-identity-sdk 主入口（服务端 / BFF 侧）。
 *
 * 门户的 Edge middleware 不走这里，走 `@vxture/core-identity-sdk/edge`。两个入口
 * 分开是硬约束：middleware 跑在 Edge runtime，一旦顺依赖拖进 node 内建或 ioredis，
 * 报错发生在**构建期**且信息量极低。
 *
 * 边界（2026-08-04 定）：
 *   进 SDK = presence 三态读写 / `/auth/login` 静默决策 / 回调静默失败分支 /
 *            middleware 工厂 / cookie 名契约
 *   不进   = 登录后去哪页、realm 选择、加载页外观（归 DS）、各门户的豁免路径
 */

export {
  RP_SESSION_COOKIE_BASE,
  RP_SESSION_COOKIE_SECURE_BASE,
  PRESENCE_ANONYMOUS,
  PRESENCE_MAX_AGE_MS,
  SILENT_FAILED_PARAM,
  presenceCookieName,
  rpSessionCookieName,
  rpSessionCookieNames,
} from "./cookies";

export {
  decideAuth,
  resolveLoginPrompt,
  resolvePresence,
  type AuthDecision,
  type PresenceInput,
  type SsoPresence,
} from "./decide";

export { IDLE_MS, startIdleWatcher, type IdleWatcherOptions } from "./idle";

export {
  anonymousPresenceCookie,
  clearPresenceCookie,
  silentFailureReturnTo,
  type CookieClearSpec,
  type CookieOptions,
  type CookieSpec,
} from "./presence";
