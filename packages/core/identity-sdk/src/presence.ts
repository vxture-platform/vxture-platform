/**
 * presence.ts —— BFF 侧的 presence 读写，**不绑框架**。
 *
 * 返回 cookie 描述而不是直接操作 `res`：Nest/Express 是当下的形态，但这份契约同样
 * 要被 Next Route Handler、测试、以后可能的 Fastify 消费。描述结构是三方的最小公约数，
 * 各自 `res.cookie(spec.name, spec.value, spec.options)` 一行接上。
 */

import {
  PRESENCE_ANONYMOUS,
  PRESENCE_MAX_AGE_MS,
  SILENT_FAILED_PARAM,
  presenceCookieName,
} from "./cookies";

export interface CookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge?: number;
}

export interface CookieSpec {
  name: string;
  value: string;
  options: CookieOptions;
}

export interface CookieClearSpec {
  name: string;
  options: Omit<CookieOptions, "maxAge">;
}

function baseOptions(secure: boolean): Omit<CookieOptions, "maxAge"> {
  return { httpOnly: true, sameSite: "lax", secure, path: "/" };
}

/**
 * 记下"刚问过 IdP，中央会话不存在"。
 *
 * 静默探测失败这件事原先**只写在 returnTo 的 URL 参数上**，前端拿到后立刻
 * replaceState 抹掉——于是它是一次性的。用户刷新一次、或重新输一次地址，整套
 * 「login → authorize → callback → 带着失败标记回门户」的往返就从头再跑一遍，
 * 只为得到上一秒刚知道的答案。这正是"要闪好几次才进登录页"的根源。
 */
export function anonymousPresenceCookie(
  app: string,
  secure: boolean,
): CookieSpec {
  return {
    name: presenceCookieName(app),
    value: PRESENCE_ANONYMOUS,
    options: { ...baseOptions(secure), maxAge: PRESENCE_MAX_AGE_MS },
  };
}

/**
 * 回到 Unknown。
 *
 * **会话建立时**要清：否则这条"没有中央会话"的备忘会在剩余有效期里继续压制静默
 * SSO，表现为登出后再登录要多走一次交互。
 * **登出时也要清**：IdP 那边的中央会话未必跟着结束（单点登出是另一条链路），
 * 留着会白白跳过下一次本可成功的静默 SSO。
 */
export function clearPresenceCookie(
  app: string,
  secure: boolean,
): CookieClearSpec {
  return { name: presenceCookieName(app), options: baseOptions(secure) };
}

/**
 * 静默失败后回门户的地址：挂上一次性标记。
 *
 * 与 presence cookie 冗余是刻意的——见 `SILENT_FAILED_PARAM`。
 */
export function silentFailureReturnTo(returnTo: string): string {
  const u = new URL(returnTo);
  u.searchParams.set(SILENT_FAILED_PARAM, "0");
  return u.toString();
}
