/**
 * internal-auth.guard.ts — server-to-server internal endpoint guard.
 * @package @vxture/bff-auth
 *
 * Protects IdP endpoints meant only for trusted backend callers (e.g.
 * admin-bff requesting an operator step-up credential, or admin-bff acting
 * on operator/tenant accounts via the internal admin routers). Requires the
 * shared AUTH_INTERNAL_TOKEN in the `x-vxture-internal-auth` header;
 * fail-closed when the token is unconfigured. Constant-time compare to
 * avoid leaking via timing.
 *
 * **Scope note (post-review correction, 2026-07-12)**: this guard does
 * NOT accept T1/T2 S2S bearer tokens. It originally did (T2), but several
 * of its consumers — `operator-admin-internal.router.ts`,
 * `account-admin-internal.router.ts` — perform operator/account admin
 * actions gated only by a caller-declared `actorOperatorId` in the request
 * body, with no cryptographic binding to the caller's identity. Accepting
 * any product's S2S token here would let any confidential OIDC client
 * mint itself access to those admin actions by simply declaring a
 * high-rank operator's id. The S2S bearer-token path now lives ONLY in
 * `PlatformAuthGuard` (`platform-auth.guard.ts`), applied to the three
 * platform-face C2/C3 self-service routers it was actually designed for.
 *
 * **Deny-by-default（2026-10-01）**：上面那段只撤掉了 bearer，共享口令那条路没撤——
 * 凭据对了就能进这个 guard 护着的任何一条路由，而「这个面有多大」在代码里看不出来。
 * 所以凭据过了之后还要过一道**路由准入**：没有 `@InternalRoute(…)` 声明的路由一律 403
 * （`internal-route-policy.ts`）。新增内部路由默认关着，要进这个面必须有人写下声明，
 * 并且 `scripts/guardrails/check-internal-route-policy.mjs` 把这个面连同自报且无绑定
 * 主体的条数钉进快照——那一档不许无声增长。
 *
 * 这一道门**不**改变 `declared-unbound` 本身（给每个调用方发独立凭据是 E2/E3，会动
 * 6 个发送点与部署密钥）。它只保证这个面是写下来的、变大要签字。
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "node:crypto";
import { VxConfigService } from "@vxture/core-config";
import type { Request } from "express";
import {
  evaluateInternalRoutePolicy,
  INTERNAL_ROUTE_POLICY,
  type InternalRoutePolicy,
} from "./internal-route-policy";

export const INTERNAL_AUTH_HEADER = "x-vxture-internal-auth";

@Injectable()
export class InternalAuthGuard implements CanActivate {
  // 显式 @Inject：esbuild 不产出 design:paramtypes，按类型注入会拿到 undefined
  // （全仓同一手法，见 check-explicit-inject 守卫）。
  constructor(
    @Inject(VxConfigService) private readonly config: VxConfigService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.auth.AUTH_INTERNAL_TOKEN;
    if (!expected) {
      throw new UnauthorizedException("internal_auth_unavailable");
    }
    const req = context.switchToHttp().getRequest<Request>();
    const presented = req.header(INTERNAL_AUTH_HEADER) ?? "";
    if (!safeEqual(presented, expected)) {
      throw new UnauthorizedException("invalid_internal_auth");
    }
    // 凭据过了**之后**才判路由准入：顺序反了，一个没有凭据的调用方会从 403 与 401
    // 的差别里读出「这条路由存不存在」。
    evaluateInternalRoutePolicy(
      // **只读方法级**，不走 getAllAndOverride 的类级回落：类级声明会让新加的路由
      // 自动继承，而「新路由自动入面」正是这道门要堵的那个洞。
      this.reflector.get<InternalRoutePolicy | undefined>(
        INTERNAL_ROUTE_POLICY,
        context.getHandler(),
      ),
      routeLabel(context),
    );
    return true;
  }
}

function routeLabel(context: ExecutionContext): string {
  const cls = context.getClass?.()?.name ?? "UnknownRouter";
  const handler = context.getHandler?.()?.name ?? "unknownHandler";
  return `${cls}.${handler}`;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
