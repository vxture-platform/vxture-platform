/**
 * capability.ts — console-bff 路由级访问策略(批 0a 权限配置体系)。
 * @package @vxture/bff-console
 *
 * 每条路由必须声明三种策略之一(identity/060 §4.2 / §7「新增路由必须声明权限 code
 * 或明确标注 @Public()」):
 *   - `@Public()`             无需会话(健康检查、OIDC RP 端点);
 *   - `@SelfScope()`          只要登录 + 租户上下文(我的资料 / 收件箱 / 能力查询…);
 *   - `@RequireCapability(…)` 持有任一给定权限码才放行;`.manage` 蕴含同资源 `.read`
 *                             (@vxture/core-utils `capabilitySatisfies`)。
 * 类级装饰器给整个 controller 定默认,方法级覆盖(Reflector.getAllAndOverride)。
 *
 * 全局守卫 `CapabilityGuard` 对**没有声明**的路由一律 403——宁可红也不能默认放行;
 * `scripts/guardrails/check-bff-route-annotations.mjs` 在 lint 期就把漏标的路由抓出来。
 *
 * 权限码从哪来:AuthMiddleware → TenantMiddleware → PermissionMiddleware 已经把
 * `req.capabilities` 填成该成员在当前租户的有效治理权限码(GovernanceService 回查,
 * 60s 缓存);守卫只读它,不再回查。
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import {
  hasAnyCapability,
  type TenantPermissionCode,
} from "@vxture/core-utils";
import type { RequestContext } from "../types/console.types";

export const ACCESS_POLICY = "console:access-policy";

export type AccessPolicy =
  | { readonly kind: "public" }
  | { readonly kind: "self" }
  | {
      readonly kind: "capability";
      readonly anyOf: readonly TenantPermissionCode[];
    };

/** 无需会话。只给认证流程本身与健康检查用。 */
export const Public = () =>
  SetMetadata<string, AccessPolicy>(ACCESS_POLICY, { kind: "public" });

/** 登录 + 租户上下文即可(本人范围的数据,或任何成员都该看到的租户基础信息)。 */
export const SelfScope = () =>
  SetMetadata<string, AccessPolicy>(ACCESS_POLICY, { kind: "self" });

/** 持有 `anyOf` 中任一权限码才放行。 */
export const RequireCapability = (...anyOf: TenantPermissionCode[]) =>
  SetMetadata<string, AccessPolicy>(ACCESS_POLICY, {
    kind: "capability",
    anyOf,
  });

/**
 * 策略求值(纯函数,便于单测)。返回 true 或抛 401/403。
 * 没有策略 = 漏标,按 403 处理并把路由名报出来。
 */
export function evaluateAccessPolicy(
  policy: AccessPolicy | undefined,
  req: Request & RequestContext,
  routeName = "route",
): true {
  if (!policy) {
    throw new ForbiddenException(
      `${routeName} has no access policy (@Public / @SelfScope / @RequireCapability)`,
    );
  }
  if (policy.kind === "public") return true;
  if (!req.user) throw new UnauthorizedException("No active session");
  if (policy.kind === "self") return true;
  if (!req.tenant)
    throw new UnauthorizedException("Tenant context is required");
  if (!hasAnyCapability(req.capabilities ?? [], policy.anyOf)) {
    throw new ForbiddenException(
      `Missing capability: ${policy.anyOf.join(" | ")}`,
    );
  }
  return true;
}

/**
 * 处理函数内部的细粒度判定(同一路由按分支要不同权限时用;例如全局搜索按持有的码
 * 决定返回哪几类结果)。401 无会话,403 无码。
 */
export function assertAnyCapability(
  req: Request & RequestContext,
  anyOf: readonly TenantPermissionCode[],
): void {
  evaluateAccessPolicy({ kind: "capability", anyOf }, req);
}

/** 只查不抛:用于按持有的码裁剪响应内容。 */
export function holdsAnyCapability(
  req: Request & RequestContext,
  anyOf: readonly TenantPermissionCode[],
): boolean {
  return hasAnyCapability(req.capabilities ?? [], anyOf);
}

@Injectable()
export class CapabilityGuard implements CanActivate {
  // 显式 @Inject:esbuild 不产出 design:paramtypes,按类型注入会拿到 undefined。
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(
      ACCESS_POLICY,
      [context.getHandler(), context.getClass()],
    );
    const req = context.switchToHttp().getRequest<Request & RequestContext>();
    return evaluateAccessPolicy(
      policy,
      req,
      `${context.getClass().name}.${context.getHandler().name}`,
    );
  }
}
