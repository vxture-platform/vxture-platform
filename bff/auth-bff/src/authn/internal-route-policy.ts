/**
 * internal-route-policy.ts — 旧凭据（`AUTH_INTERNAL_TOKEN`）路径的路由准入声明。
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
 *   · `declared-ignored` DTO 里有这个字段，但本路由**有意不读**（见
 *                        `account-admin-internal.router.ts` 的说明：客户正文里点名
 *                        一个运营者既无必要也是泄露）；
 *   · `declared-unbound` 请求体点名**代为操作的运营者**，而没有任何东西证明它——
 *                        rank 门比的也是这个自报主体。**这一档就是共享口令的真实半径**，
 *                        它在册、有数、不许悄悄变多。
 *
 * ── 这一层不做什么 ──
 * 它**不**把 `declared-unbound` 改成绑定主体——那要给每个调用方发独立凭据（E2/E3），
 * 会动 6 个发送点与部署密钥，不在本批。它只保证：这个面今天有多大是写下来的，
 * 明天变大需要有人签字。
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
  | "declared-ignored"
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
