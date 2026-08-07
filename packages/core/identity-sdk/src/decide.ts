/**
 * decide.ts —— SSO Presence 三态机的**纯判定**。
 *
 * 认证链路里唯一有分支的地方。刻意做成不碰 cookie API、不碰框架、不发网络的纯函数：
 *   · Edge middleware 用它决定「渲染之前」做什么
 *   · BFF 的 /auth/login 用它决定这一轮要不要静默
 *   · 单测直接喂结构体，不用起 Next 也不用起 Nest
 *
 * **不做会话有效性校验**是设计而非遗漏：那是一次阻塞每个请求的网络调用，代价远超
 * 它挡掉的那点无效渲染。cookie 在但会话已失效由应用兜底（业务接口 401 → 跳转）。
 * 那是少数路径，值得慢；首访是多数路径，必须快。
 */

/**
 * 三态。
 *
 *   authenticated —— RP 会话 cookie 在（不代表有效，见上）
 *   anonymous     —— 刚问过 IdP，中央会话不存在
 *   unknown       —— 还没问过
 */
export type SsoPresence = "authenticated" | "anonymous" | "unknown";

export interface PresenceInput {
  /** RP 会话 cookie 是否存在（两个候选名任一命中即可，见 rpSessionCookieNames）。 */
  hasRpSession: boolean;
  /** presence cookie 的值，读不到给 null。 */
  presenceCookie?: string | null | undefined;
  /** URL 上的 `vx_sso_silent` 参数值，没有给 null。 */
  silentParam?: string | null | undefined;
}

/**
 * 判定当前身份状态。
 *
 * Anonymous **有两个独立来源，任一命中即可**——见 SILENT_FAILED_PARAM 的注释：
 * 只认 cookie 会在 cookie 存不住时打出无限重定向（2026-08-04 用无 cookie jar 的
 * curl 实测复现）。
 */
export function resolvePresence(input: PresenceInput): SsoPresence {
  if (input.hasRpSession) return "authenticated";
  const silentJustFailed = input.silentParam === "0";
  if (silentJustFailed || input.presenceCookie === "anonymous") {
    return "anonymous";
  }
  return "unknown";
}

/** 判定结果：放行，或去登录（`prompt` 决定静默还是交互）。 */
export type AuthDecision =
  | { action: "allow" }
  | { action: "login"; prompt: "none" | undefined };

/**
 * 三态 → 动作。
 *
 * Anonymous 已经确认没有中央会话，再静默问一次是白跑「authorize(prompt=none) →
 * callback(login_required) → 回门户」3 跳外加一次整页绘制；只有 Unknown 才值得问。
 */
export function decideAuth(input: PresenceInput): AuthDecision {
  const presence = resolvePresence(input);
  if (presence === "authenticated") return { action: "allow" };
  return {
    action: "login",
    prompt: presence === "unknown" ? "none" : undefined,
  };
}

/**
 * BFF 侧：这一轮 `/auth/login` 实际该用的 prompt。
 *
 * 与 `decideAuth` 是同一条规则的另一端——门户可能已经决定静默，但 BFF 手上有
 * presence cookie 的**最新**值（门户那次判断可能来自一个刚过期的缓存，或者请求
 * 根本没经过 middleware，比如直接访问 BFF 域名）。所以这里再兜一次。
 */
export function resolveLoginPrompt(
  requestedPrompt: string | undefined,
  presenceCookie: string | null | undefined,
): string | undefined {
  if (requestedPrompt === "none" && presenceCookie === "anonymous") {
    return undefined;
  }
  return requestedPrompt;
}
