/**
 * auth.service.spec.ts — 旧桥删了：会话里的能力集就是库里的 perm_code，没有合成码。
 *
 * LEGACY_CAPABILITY_BRIDGE 曾把 tenant:profile.manage 合成成 platform.tenant.manage、
 * product:plan.manage 合成成 platform.product.manage（2026-10-04 删）。它在的时候，一个
 * router 只要判合成码就能「看起来有门」，而目录里的细码一个消费方都没有——这条用例钉的
 * 是：以后谁把桥加回来（哪怕只加一条），这里当场红。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PlatformAuthService } from "./auth.service";

function poolWith(permissions: string[]): Pool {
  return {
    query: vi.fn(async () => ({
      rows: [
        {
          id: "op-1",
          username: "ops",
          email: null,
          phone: null,
          display_name: "运营",
          role_code: "operator",
          role_name_key: "catalog.ops.role.operator.name",
          role_name: "Operator",
          role_rank: 30,
          email_verified: false,
          permissions,
        },
      ],
    })),
  } as unknown as Pool;
}

describe("PlatformAuthService.getCapabilities", () => {
  it("只回库里的码，不合成任何遗留扁平串", async () => {
    const svc = new PlatformAuthService(
      poolWith(["tenant:profile.manage", "product:plan.manage"]),
    );
    const caps = await svc.getCapabilities("op-1");
    expect(caps.sort()).toEqual([
      "product:plan.manage",
      "tenant:profile.manage",
    ]);
    /* 旧桥合成出来的两个串（无冒号，不是目录形状）一个都不许出现。 */
    expect(caps.some((c) => c.startsWith("platform."))).toBe(false);
  });

  it("去重但不增删", async () => {
    const svc = new PlatformAuthService(
      poolWith(["support:ticket.read", "support:ticket.read"]),
    );
    expect(await svc.getCapabilities("op-1")).toEqual(["support:ticket.read"]);
  });

  it("查不到账号 → 空集（不是 undefined，调用方拿它 includes）", async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [] })),
    } as unknown as Pool;
    expect(
      await new PlatformAuthService(pool).getCapabilities("ghost"),
    ).toEqual([]);
  });
});
