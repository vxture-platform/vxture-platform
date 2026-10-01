import { describe, expect, it } from "vitest";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { InternalAuthGuard, INTERNAL_AUTH_HEADER } from "./internal-auth.guard";
import {
  INTERNAL_ROUTE_POLICY,
  type InternalRoutePolicy,
} from "./internal-route-policy";

// Unit tests: legacy shared-secret guard only. This guard protects
// operator/account admin-internal routers (post-review scope correction,
// 2026-07-12) — it must NEVER accept a bearer/S2S credential; see
// platform-auth.guard.spec.ts for the dual-accept guard used by the
// platform-face C2/C3 self-service routers.
//
// 2026-10-01 起它还有第二道门：路由准入（deny-by-default）。两道门的**顺序**是
// 本文件最该守住的性质，见「凭据先判」那一组。

const SHARED_SECRET = "shared-secret-value-32-bytes-min";

const DECLARED: InternalRoutePolicy = {
  risk: "admin-action",
  actor: "declared-unbound",
  why: "测试用",
};

/**
 * 假 Reflector：只实现 `get`，并且**只认方法级 target**——与实现一致（实现不走
 * getAllAndOverride 的类级回落，理由见 internal-route-policy.ts）。
 */
function fakeReflector(policyByHandler: Map<unknown, InternalRoutePolicy>) {
  return {
    get: (key: string, target: unknown) =>
      key === INTERNAL_ROUTE_POLICY ? policyByHandler.get(target) : undefined,
  } as unknown as Reflector;
}

function makeGuard(
  authInternalToken: string | undefined,
  policyByHandler = new Map<unknown, InternalRoutePolicy>(),
): InternalAuthGuard {
  const config = {
    auth: { AUTH_INTERNAL_TOKEN: authInternalToken },
  } as unknown as ConstructorParameters<typeof InternalAuthGuard>[0];
  return new InternalAuthGuard(config, fakeReflector(policyByHandler));
}

interface FakeRequest {
  headers: Record<string, string>;
  header(name: string): string | undefined;
}

function fakeRequest(headers: Record<string, string> = {}): FakeRequest {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    headers: lower,
    header(name: string) {
      return lower[name.toLowerCase()];
    },
  };
}

function handlerFn(): void {}
class FakeRouter {}

function ctx(req: FakeRequest, handler: unknown = handlerFn): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => FakeRouter,
  } as unknown as ExecutionContext;
}

/** 已声明的上下文（声明挂在 handlerFn 上）。 */
function declaredCtx(req: FakeRequest) {
  return {
    guard: (token: string | undefined = SHARED_SECRET) =>
      makeGuard(token, new Map([[handlerFn, DECLARED]])),
    context: ctx(req),
  };
}

describe("InternalAuthGuard · 凭据", () => {
  it("passes with a correct x-vxture-internal-auth header on a declared route", () => {
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: SHARED_SECRET });
    const { guard, context } = declaredCtx(req);
    expect(guard().canActivate(context)).toBe(true);
  });

  it("rejects a wrong shared secret", () => {
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: "wrong" });
    const { guard, context } = declaredCtx(req);
    expect(() => guard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it("fails closed when AUTH_INTERNAL_TOKEN is unconfigured", () => {
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: "anything" });
    const { guard, context } = declaredCtx(req);
    expect(() => guard(undefined).canActivate(context)).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects when no header is presented", () => {
    const { guard, context } = declaredCtx(fakeRequest());
    expect(() => guard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it("ignores an Authorization: Bearer header — this guard has no S2S path", () => {
    // A caller presenting a bearer token (even a well-formed one) but no
    // legacy header must still be rejected here — this guard's consumers
    // (operator/account admin-internal routers) must never accept S2S
    // tokens, which is exactly the bug the platform-auth.guard.ts split fixed.
    const req = fakeRequest({ authorization: "Bearer some.jwt.token" });
    const { guard, context } = declaredCtx(req);
    expect(() => guard().canActivate(context)).toThrow(UnauthorizedException);
  });
});

describe("InternalAuthGuard · 路由准入（deny-by-default）", () => {
  it("凭据对但路由没声明 → 403，不是放行", () => {
    const guard = makeGuard(SHARED_SECRET); // 空声明表
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: SHARED_SECRET });
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it("类级声明不生效：声明挂在 class 上时仍然 403", () => {
    // 实现只读方法级。这条测试锁住那个选择——否则有人把声明挪到 @Controller 上，
    // 整个 controller 会「看起来声明了」而实际全是 deny（或更糟，全是放行）。
    const guard = makeGuard(SHARED_SECRET, new Map([[FakeRouter, DECLARED]]));
    const req = fakeRequest({ [INTERNAL_AUTH_HEADER]: SHARED_SECRET });
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it("两道门的顺序：没凭据 + 没声明 → 401 而不是 403", () => {
    // 顺序反了的话，没有凭据的调用方能从 403 与 401 的差别里读出「这条路由
    // 存不存在」。这是本文件最该守住的性质。
    const guard = makeGuard(SHARED_SECRET);
    expect(() => guard.canActivate(ctx(fakeRequest()))).toThrow(
      UnauthorizedException,
    );
  });
});
