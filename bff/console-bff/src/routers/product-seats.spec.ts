/**
 * product-seats.spec.ts —— 席位指派的四种拒因必须各说各的话（2026-09-27）。
 *
 * owner 裁定②「超限硬拦截，席位已满」。上限由库里的 `trg_product_seats_enforce_limit`
 * 判，这一层只负责把库抛的错翻成一句话——**而这一层最容易出的错是把四件事说成一件**。
 *
 * 四种拒因的下一步动作完全不同：
 *   seat_limit_reached   → 去套餐版本里把 seat.max 改大，或先撤销一个
 *   already_granted      → 什么都不用做，他已经有了
 *   product_not_covered  → 这个工作空间得先订阅这个产品
 *   not_a_member         → 先把人加进这个工作空间
 * 合成一句「指派失败」的话，四条路里有三条会让人去做错的事。所以这份 spec 钉的不是
 * 「会不会抛」，而是**抛出来的状态码彼此不同、且与语义对得上**：满了 / 已有是 409
 * （请求没错，是当前状态冲突），没订阅 / 不是成员是 404（那个东西不在）。
 *
 * 顺带钉住撤销的幂等：本来没占着也回 ok。重复点「撤销」的两次意图完全一样，
 * 报错只会让人以为出了问题（与 removeWorkspaceMember 同一条取舍）。
 */
import { describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import type { Request } from "express";

import { IamRouter } from "./iam.router";
import type { RequestContext } from "../types/console.types";

const WS = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";

function req(): Request & RequestContext {
  return {
    user: { id: "caller" },
    tenant: { id: "tenant" },
    headers: {},
  } as unknown as Request & RequestContext;
}

/** 审计写钩子是 fire-and-forget，给它一个不会炸的池即可。 */
function auditPool(): Pool {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
}

function routerWith(aggregator: Record<string, unknown>): IamRouter {
  const none = undefined as never;
  return new IamRouter(aggregator as never, auditPool(), none, none, none);
}

describe("产品席位：拒因 → 状态码", () => {
  const cases = [
    { reason: "seat_limit_reached", type: ConflictException, status: 409 },
    { reason: "already_granted", type: ConflictException, status: 409 },
    { reason: "product_not_covered", type: NotFoundException, status: 404 },
    { reason: "not_a_member", type: NotFoundException, status: 404 },
  ] as const;

  for (const c of cases) {
    it(`${c.reason} → ${c.status}`, async () => {
      const router = routerWith({
        grantProductSeatScoped: vi.fn(async () => ({
          ok: false as const,
          reason: c.reason,
        })),
      });
      await expect(
        router.grantProductSeat(req(), WS, {
          productId: PRODUCT,
          userId: MEMBER,
        }),
      ).rejects.toBeInstanceOf(c.type);
    });
  }

  it("四种拒因的状态码不能塌成一个", async () => {
    const statuses = new Set<number>();
    for (const c of cases) {
      const router = routerWith({
        grantProductSeatScoped: vi.fn(async () => ({
          ok: false as const,
          reason: c.reason,
        })),
      });
      try {
        await router.grantProductSeat(req(), WS, {
          productId: PRODUCT,
          userId: MEMBER,
        });
      } catch (caught) {
        statuses.add((caught as { getStatus(): number }).getStatus());
      }
    }
    /* 两档：409（当前状态冲突）与 404（那个东西不在）。只剩一档就说明有人把它们合并了。 */
    expect([...statuses].sort()).toEqual([404, 409]);
  });

  it("拒因的 message 就是原因码——前端据此选文案，不做字符串匹配", async () => {
    const router = routerWith({
      grantProductSeatScoped: vi.fn(async () => ({
        ok: false as const,
        reason: "seat_limit_reached" as const,
      })),
    });
    await expect(
      router.grantProductSeat(req(), WS, {
        productId: PRODUCT,
        userId: MEMBER,
      }),
    ).rejects.toMatchObject({ message: "seat_limit_reached" });
  });
});

describe("产品席位：入参与幂等", () => {
  it("缺 productId 不该走到 aggregator", async () => {
    const grant = vi.fn();
    const router = routerWith({ grantProductSeatScoped: grant });
    await expect(
      router.grantProductSeat(req(), WS, { userId: MEMBER }),
    ).rejects.toThrow();
    expect(grant).not.toHaveBeenCalled();
  });

  it("缺 userId 不该走到 aggregator", async () => {
    const grant = vi.fn();
    const router = routerWith({ grantProductSeatScoped: grant });
    await expect(
      router.grantProductSeat(req(), WS, { productId: PRODUCT }),
    ).rejects.toThrow();
    expect(grant).not.toHaveBeenCalled();
  });

  it("撤销一个本来没占着的席位仍回 ok（重复点的两次意图一样）", async () => {
    const router = routerWith({
      revokeProductSeatScoped: vi.fn(async () => ({
        ok: true as const,
        removed: false,
      })),
    });
    await expect(
      router.revokeProductSeat(req(), WS, PRODUCT, MEMBER),
    ).resolves.toEqual({ ok: true });
  });

  it("没有租户上下文 → 404，而不是当成「没有席位」", async () => {
    const router = routerWith({
      listWorkspaceProductSeats: vi.fn(async () => null),
    });
    await expect(router.listProductSeats(req(), WS)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
