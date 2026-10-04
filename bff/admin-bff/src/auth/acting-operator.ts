/**
 * acting-operator.ts — 「代为操作的运营者」= id + 他自己的会话 access token。
 * @package @vxture/bff-admin
 *
 * 2026-10-04（E1 PR C）起，auth-bff 的账号路由不再只收请求体里自报的 `actorOperatorId`：
 * 类级 `ActorBindingGuard` 要求 `x-vxture-actor-token` 里带该运营者自己的会话 access token
 * （aud=admin / arche、sub == actorOperatorId、中央会话仍在），否则 401。所以委托给 IdP 的每一
 * 个调用点都要把这两样一起送——合成一个对象，让「忘了送票」在编译期就过不去，而不是运行期 401。
 *
 * token 来自 `AuthMiddleware` 挂在请求上下文里的 `operatorAccessToken`（RP 会话解析出来的那张
 * 票，server-side only，从不下发）。
 */
export interface ActingOperator {
  /** admin.operator_account.id（UUID）。进请求体 `actorOperatorId`，审计正文要它。 */
  readonly operatorId: string;
  /** 该运营者自己的 RS256 会话 access token。只进 `x-vxture-actor-token` 头，不进正文、不进日志。 */
  readonly accessToken: string;
}
