/**
 * s2s-scope.ts — binds a T2 S2S-authenticated request to the caller's own
 * identity (TD-035, product_210 §8 T2 residual gap).
 *
 * PlatformAuthGuard authenticates "this is a trusted caller" but the three
 * platform routers never bound that identity to the workspace/product the
 * request asks about — any valid S2S token could query any workspace/product
 * combination, since the guard's Bearer path and the legacy shared-secret
 * path were permission-equivalent. `s2sCaller.workspaceId` is already D2-
 * validated at mint time (TokenExchangeService, both OBO and service mode
 * always populate it), so when present it is safe to trust outright — the
 * request's own declared `workspace_id` is discarded rather than merely
 * cross-checked, which also saves a redundant coverage query.
 *
 * ── 旧凭据那条路：2026-10-02 起每个调用点必须把选择写出来 ──
 *
 * 走旧凭据（共享 `x-vxture-internal-auth`）进来时 `PlatformAuthGuard` **不设**
 * `req.s2sCaller`（`platform-auth.guard.ts:84-93`），于是本函数此前**原样回显请求体自报的
 * workspace**，而那个值下一跳就进了 SQL 的归属谓词。两条链都追到底过：
 *   · 配额池 → `pg-consume.repository.ts` `where qp.workspace_id = $1`；
 *   · 共享可见集 → `sharing.service.ts resolveCaller(workspaceId, productCode)`，整条链的
 *     tenant 全从这个自报值派生，而 `materialize` 还会**往那个工作空间写**物化行。
 *
 * 根治要么 fail-closed、要么要求旧凭据另带一个绑定头，**两种都要五个产品端换凭据**，
 * 所以是 owner 的取舍 + 对外协调，不是本函数能决定的（E2/E3，见接入通则）。
 *
 * 本次能做的是把**隐式默认变成显式声明**：`legacy` 参数必填，每个调用点自己写明走旧凭据
 * 时怎么办。理由是 E4 那一批验证过的同一条——「守卫只长在一条分支，等于给别条留门」：
 * 一个隐式的 `return requested` 不会在任何清单上出现，而一个必填参数会，
 * `check-s2s-legacy-scope.mjs` 把这五处连同各自的选择钉进快照，**第六处出现时必须自己选**。
 *
 * 今天只有一格收紧了：`intent="reserve"`（见 `platform-usage.router.ts`）。它是 2026-10-01
 * 才上的、**没有任何产品在用**，所以收紧零破坏；而它恰恰是那个会**拒绝客户操作**的新机关，
 * 不该由一个身份不可证的调用方来驱动。其余四格仍是 `trust-declared` ——
 * 它们今天承载着在产流量，收紧前必须先与对接方换凭据。
 */
import { ForbiddenException } from "@nestjs/common";
import type { S2sCallerCtx } from "./s2s-caller";

/**
 * 走旧凭据（无 `s2sCaller`）时本调用点怎么办。**必填**——不给默认值是本次改动的全部意义：
 * 默认值会让下一个调用点在没人注意的情况下继承「信任自报」。
 *
 *   · `"trust-declared"` —— 原样回显请求体自报的 workspace（**2026-10-02 之前的行为**）。
 *     选它的调用点必须在 `check-s2s-legacy-scope.mjs` 的快照里登记，并写明它承载什么流量。
 *   · `"deny"` —— 旧凭据不许走这条路，当场 403 `s2s_legacy_path_not_allowed`。
 *     给「新加的、还没有在产调用方」的能力用：那种能力没有存量要迁，直接关掉最省事。
 */
export type LegacyScopePolicy = "trust-declared" | "deny";

/**
 * Resolve the workspace to actually use, and reject a request whose declared
 * product(s) don't match the caller's own product identity.
 *
 * `legacy` 决定没有 `s2sCaller`（= 走旧凭据共享口令）时怎么办，见上面的类型注释。
 */
export function scopeToS2sCaller(
  s2sCaller: S2sCallerCtx | undefined,
  requested: { workspaceId: string; productCodes: readonly string[] },
  legacy: LegacyScopePolicy,
): { workspaceId: string } {
  if (!s2sCaller) {
    if (legacy === "deny") {
      // 旧凭据证明不了「是谁在调」——共享口令每个产品同一个值，请求体里的 `product`
      // 是自报的。所以这条路不许驱动会拒绝客户操作的能力。
      throw new ForbiddenException("s2s_legacy_path_not_allowed");
    }
    return { workspaceId: requested.workspaceId };
  }
  if (!s2sCaller.workspaceId) {
    // Defensive: every token minted by TokenExchangeService carries
    // workspace_id (OBO derives it from active_workspace, service mode
    // requires it to mint at all) — this should be unreachable, but a token
    // whose scope can't be verified must fail closed, not fall back to
    // trusting the caller-declared workspace_id.
    throw new ForbiddenException("s2s_scope_missing_workspace");
  }
  if (requested.productCodes.some((code) => code !== s2sCaller.productCode)) {
    throw new ForbiddenException("s2s_product_mismatch");
  }
  return { workspaceId: s2sCaller.workspaceId };
}
