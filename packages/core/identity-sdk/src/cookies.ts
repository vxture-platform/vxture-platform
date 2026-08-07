/**
 * cookies.ts —— 认证链路的 **cookie 契约**：名字、值、时效。
 *
 * 这份文件是整个 SDK 里唯一必须被三方同时认同的东西：种 cookie 的 BFF、读 cookie
 * 的门户 middleware、以及浏览器。三方任意两边对不上，症状都极难归因——服务端整条
 * 链路成功（换票、建会话、写 last_login_at 全对），只有浏览器什么也没拿到，用户
 * 被弹回登录页再试一次。2026-08-04 就是这样丢了半小时：`__Host-` 前缀要求
 * Secure，本地 http 下浏览器**静默丢弃**，没有任何一处报错。
 *
 * 所以它是纯常量与纯函数，**不依赖任何运行时**：Edge middleware、Node BFF、
 * 单元测试都能直接 import。
 */

/** 生产 https：`__Host-` 前缀强制 Secure + path=/ + 无 Domain，最强的同源约束。 */
export const RP_SESSION_COOKIE_SECURE_BASE = "__Host-vx_rp_session";

/** 本地 http：去掉前缀，否则浏览器拒绝存储（Secure 缺失）。 */
export const RP_SESSION_COOKIE_BASE = "vx_rp_session";

/**
 * RP 会话 cookie 名。
 *
 * `app` = OIDC client id（admin / console / opera / website），**必填**。
 * 生产上各门户各有 host，`__Host-` 本就是 host 作用域，共用一个名字也不串；
 * 本地四个门户同在 `localhost`，而 **cookie 无视端口**——共用名字会让 console 的
 * 会话 cookie 被 admin 的 middleware 当成"已登录"，渲染完再被自己 BFF 的 401 打回，
 * 正好是三态机要消灭的那次闪烁。BFF 侧一直是安全的（会话存储按应用分 keyspace，
 * 外来 id 直接查不到），所以它表现为体验缺陷而非越权。
 *
 * 参数不给默认值：省略 `app` 会静默退回共用名，而这正是没人会回头复查的那种默认。
 */
export function rpSessionCookieName(secure: boolean, app: string): string {
  const base = secure ? RP_SESSION_COOKIE_SECURE_BASE : RP_SESSION_COOKIE_BASE;
  return `${base}_${app}`;
}

/**
 * 读取侧要认的**两个**名字。
 *
 * middleware 不知道自己跑在 https 还是本地 http（同一份代码两处部署），与其引一个
 * 环境变量进来，不如两个都认——它只是一道前置闸，认宽一点最坏是多渲染一次，认窄
 * 了却是整站登不进。
 */
export function rpSessionCookieNames(app: string): readonly [string, string] {
  return [rpSessionCookieName(true, app), rpSessionCookieName(false, app)];
}

/**
 * SSO Presence cookie 名。
 *
 * 三态里唯一需要显式存储的那一态（Authenticated 由会话 cookie 自己表达，Unknown
 * 是"两个都没有"）。httpOnly：判断全在服务端与 middleware，页面脚本不参与。
 */
export function presenceCookieName(app: string): string {
  return `vx_${app}_sso_presence`;
}

/** presence 的唯一有效值。其余值（含伪造）一律当 Unknown 处理。 */
export const PRESENCE_ANONYMOUS = "anonymous";

/**
 * 5 分钟。
 *
 * 够覆盖"连续刷新几次"这一个用途；短到用户真去 IdP 登录成功后，这条备忘不会在
 * 剩余有效期里继续压制静默 SSO。它是缓存不是凭据：过期或被伪造，最坏让人**多走**
 * 一次交互登录，不会让任何人少走一步认证。
 */
export const PRESENCE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * BFF 在静默探测失败后挂回 returnTo 上的一次性标记。
 *
 * 它与 presence cookie **刻意冗余**：presence 是持久的但依赖 cookie 能落盘，本参数
 * 不依赖 cookie 但只活一跳。少了它，cookie 一旦存不住（浏览器策略、SameSite、
 * 非浏览器客户端）整条链路就是无限重定向——比它要解决的闪烁严重得多。
 */
export const SILENT_FAILED_PARAM = "vx_sso_silent";
