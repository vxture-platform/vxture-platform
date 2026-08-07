/**
 * edge.ts —— @vxture/core-identity-sdk/edge：门户 middleware 用的**边缘安全**子入口。
 *
 * 这里只允许出现纯逻辑与 `next/server`。主入口的 presence cookie 描述、以后可能加入的
 * 会话存储访问都不得从这里泄漏——Edge runtime 下引入 node 内建会在构建期失败，
 * 而 Next 给出的错误信息几乎指不到真正的引入点。
 */

export {
  PRESENCE_ANONYMOUS,
  PRESENCE_MAX_AGE_MS,
  SILENT_FAILED_PARAM,
  presenceCookieName,
  rpSessionCookieName,
  rpSessionCookieNames,
} from "./cookies";

export {
  decideAuth,
  resolvePresence,
  type AuthDecision,
  type PresenceInput,
  type SsoPresence,
} from "./decide";

export {
  createAuthMiddleware,
  isDefaultExempt,
  type AuthMiddlewareOptions,
} from "./next-middleware";
