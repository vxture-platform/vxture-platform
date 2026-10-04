/**
 * internal-route-policy.ts — 共享口令（`IDP_INTERNAL_TOKEN`，2026-10-04 起；此前与产品面共用
 * `AUTH_INTERNAL_TOKEN`）路径的路由准入声明。
 * @package @vxture/bff-auth
 *
 * ── 补的是哪个盲区 ──
 * 共享口令只证明「调用方持有平台口令」，**不证明调用方是谁**。于是 `InternalAuthGuard`
 * 过了之后，这条路径上的每一道门其实都是同一把钥匙开的——而它开的面今天有多大、
 * 新增一条内部路由会不会自动加入这个面，代码里看不出来，也没有任何东西拦。
 *
 * 这一层把那个面变成**显式、收口、可复核**的：
 *   · `InternalAuthGuard` 改成 **deny-by-default** —— 没有 `@InternalRoute(…)` 声明的
 *     路由，凭据对也进不去。新增内部路由默认是关着的，要进这个面必须有人写下声明。
 *   · 声明里带 `risk` 与 `actor` 两个轴，说明这条路由**拿什么当授权依据**；
 *     `why` 是写给复核的人看的一句话，守卫要求它非空。
 *   · `scripts/guardrails/check-internal-route-policy.mjs` 把这个面连同
 *     `actor: "declared-unbound"` 的条数钉进快照——**那一档的条数不许无声增长**。
 *
 * ── `actor` 四档是从代码里读出来的，不是设计出来的 ──
 * 这条路径上的路由对「谁在操作」的处理方式实际有四种，差别很大，合并成两档会把
 * 最该被看见的那一档藏掉：
 *   · `none`             请求里没有主体（列运营者会话）；
 *   · `proven`           请求体点名主体，**同时带只有该主体能给出的证明**（TOTP 码）；
 *   · `token-bound`      请求体点名**代为操作的运营者**，且类级 `ActorBindingGuard` 用该
 *                        运营者**自己的会话 access token**（`x-vxture-actor-token`）证明它：
 *                        验签、aud ∈ {admin, arche}、sub 相符、中央会话仍在（2026-10-04 PR C）。
 *                        handler 读不读那个字段是另一件事——`account-admin-internal` 的三条
 *                        有意不读（客户正文里点名一个运营者既无必要也是泄露），门上照样绑；
 *   · `declared-unbound` 请求体点名代为操作的运营者，而没有任何东西证明它——rank 门比的也是
 *                        这个自报主体。**这一档曾是共享口令的真实半径**（8 条），PR C 之后为 0；
 *                        它仍在册、有数，再出现一条就是在给共享口令开一扇无绑定的新门。
 *   （`declared-ignored` 曾是第三档——「字段在、handler 不读」；PR C 后那三条路由门上已绑定，
 *   这一档没有住户，撤了。）
 *
 * ── 这一层不做什么 ──
 * 主体绑定在 `actor-binding.guard.ts`，不在这里；这里只保证：这个面今天有多大、哪些路由
 * 的主体是绑定的，都是写下来的，明天变化需要有人签字（`check-internal-route-policy.mjs`
 * 同时核「声明 token-bound 的 controller 真挂着 ActorBindingGuard」这一半）。按调用方发独立
 * 凭据、让 IdP 分得出 admin 还是 arche 在调（E2/E3）仍不在本批。
 */
import { ForbiddenException, SetMetadata } from "@nestjs/common";

export const INTERNAL_ROUTE_POLICY = "auth:internal-route-policy";

/** 这条路由做的事有多重。 */
export type InternalRouteRisk =
  /** 只读。 */
  | "read"
  /** 签发凭据（step-up 票之类）。 */
  | "credential-mint"
  /** 改运营者或客户账号的状态、凭据、会话。 */
  | "admin-action";

/** 这条路由拿什么当「谁在操作」的依据。四档的区别见文件头。 */
export type InternalRouteActor =
  | "none"
  | "proven"
  | "token-bound"
  | "declared-unbound";

export interface InternalRoutePolicy {
  readonly risk: InternalRouteRisk;
  readonly actor: InternalRouteActor;
  /** 一句话：谁调它、为什么它可以走共享口令。守卫要求非空。 */
  readonly why: string;
}

/**
 * 声明这条路由允许用旧凭据进入。
 *
 * **只在方法上写，不支持类级**——这是与 console-bff 的 `@Public` / `@SelfScope` /
 * `@RequireCapability` 刻意不同的一处：那三个用 `getAllAndOverride` 让类级当默认值，
 * 图的是省样板；而这里类级声明会让**新加的路由自动继承**，「新路由无声入面」正是
 * 这道门要堵的洞。所以 `InternalAuthGuard` 只读 `Reflector.get(…, getHandler())`，
 * 写在 `@Controller` 上不生效（守卫会把它报成漏标）。
 */
export const InternalRoute = (policy: InternalRoutePolicy) =>
  SetMetadata<string, InternalRoutePolicy>(INTERNAL_ROUTE_POLICY, policy);

/**
 * 准入求值（纯函数，便于单测）。没有声明 = 漏标，按 403 拒绝并把路由名报出来。
 *
 * **调用顺序有要求**：必须在凭据校验**之后**调。反了的话，一个没有凭据的调用方会
 * 从 403（路由在、但没声明）和 401（凭据不对）的差别里读出「这条路由存不存在」。
 */
export function evaluateInternalRoutePolicy(
  policy: InternalRoutePolicy | undefined,
  routeName = "route",
): InternalRoutePolicy {
  if (!policy) {
    throw new ForbiddenException(
      `${routeName}: no @InternalRoute() policy — the legacy shared-secret path is deny-by-default`,
    );
  }
  if (!policy.why.trim()) {
    throw new ForbiddenException(
      `${routeName}: @InternalRoute() policy has an empty \`why\``,
    );
  }
  return policy;
}
