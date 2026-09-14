/**
 * step-up.verify.ts — step-up 凭证的判定本体。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * 全局守卫（`step-up.guard.ts`）只认路由上的 `@RequireStepUp()` 元数据——那适合
 * 「这条路由永远是高危写」。产品接入的合并保存不是：同一次保存可能只改了产品名，
 * 也可能往登录回调白名单里加了一个地址。前者不该要求二次验证，后者必须要。
 *
 * 所以判定抽成函数：路由在**读出本次改动**之后按需调用，守卫也调它。判据只有这一份——
 * 不会出现守卫收紧了、按需调用那一侧还是旧规则。
 *
 * 不变量与守卫相同：绑会话（凭证 `sub` 必须是当前会话 operator）、fail-closed
 * （验不出来就是没过，JWKS 抖动不放行）。缺失 / 过期 / 不匹配一律
 * `403 step_up_required`，门户据此发起仪式后重试整个请求。
 */
import type { OidcRpClient } from "@vxture/core-oidc-rp";
import type { Request } from "express";
import type { RpRuntime } from "../oidc/oidc-rp.tokens";
import type { RequestContext } from "../types/request-context";
import { stepUpRequired } from "../errors/api-error";
import { stepUpCookieName } from "./step-up.decorator";

export async function assertFreshStepUp(
  req: Request & RequestContext,
  oidcClient: OidcRpClient,
  rpRuntime: RpRuntime,
): Promise<void> {
  const sessionOperatorId = req.operator?.id;
  if (!sessionOperatorId) {
    // OperatorAuthMiddleware 本该填好；缺失即无会话。
    throw stepUpRequired();
  }
  const token = req.cookies?.[stepUpCookieName(rpRuntime.cookieSecure)];
  if (!token || typeof token !== "string") {
    throw stepUpRequired();
  }
  let claims: Record<string, unknown>;
  try {
    // RS256/JWKS + iss + exp + aud=opera（与 access token 同一签发方）。
    claims = await oidcClient.verifyAccessToken(token);
  } catch {
    throw stepUpRequired();
  }
  const boundToSession = claims.sub === `opr_${sessionOperatorId}`;
  if (claims.stepup !== true || !boundToSession) {
    throw stepUpRequired();
  }
}
