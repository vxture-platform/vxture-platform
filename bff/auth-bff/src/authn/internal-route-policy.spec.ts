import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import {
  evaluateInternalRoutePolicy,
  type InternalRoutePolicy,
} from "./internal-route-policy";

// 纯求值函数的单测。运行时两道门的顺序在 internal-auth.guard.spec.ts 里锁。

const OK: InternalRoutePolicy = {
  risk: "admin-action",
  actor: "declared-unbound",
  why: "admin-bff 代运营者操作；rank 门比自报主体",
};

describe("evaluateInternalRoutePolicy", () => {
  it("没有声明 → 403（deny-by-default），并把路由名报出来", () => {
    try {
      evaluateInternalRoutePolicy(undefined, "FooRouter.bar");
      expect.unreachable("应当抛 ForbiddenException");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as Error).message).toContain("FooRouter.bar");
      // 报文要说清这是「默认拒」而不是「凭据不对」，否则排障会走到凭据上去
      expect((e as Error).message).toContain("deny-by-default");
    }
  });

  it("声明完整 → 原样返回", () => {
    expect(evaluateInternalRoutePolicy(OK, "FooRouter.bar")).toBe(OK);
  });

  it("why 为空白 → 403：它是写给复核的人的，空着等于没声明", () => {
    expect(() =>
      evaluateInternalRoutePolicy({ ...OK, why: "   " }, "FooRouter.bar"),
    ).toThrow(ForbiddenException);
  });

  it("四档 actor 都能过求值 —— 求值不判轻重，轻重由守卫的快照钉", () => {
    const actors: InternalRoutePolicy["actor"][] = [
      "none",
      "proven",
      "declared-ignored",
      "declared-unbound",
    ];
    for (const actor of actors) {
      expect(evaluateInternalRoutePolicy({ ...OK, actor }).actor).toBe(actor);
    }
  });
});
