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

import {
  IamRouter,
  composeSeatLimitNotice,
  seatNoticeDayKey,
} from "./iam.router";
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

/**
 * 席位已满要在运营台留一条（2026-09-28 第二批 C-3）。
 *
 * 此前这条路**库里一行都不留**：触发器抛 VX409、这一层翻成 409 给客户，运营那边看不出
 * 有人撞到了上限——而「撞到上限」正是「该升档」的信号，owner 2026-09-28「把信息做全做多」。
 * 这里钉的是：只有 seat_limit_reached 这一支写、写的内容里没有 UUID、以及**写失败不改变
 * 那个 409**（客户要拿到的是那个状态码，不是通告的成败）。
 */
function seatPool(opts: { subject?: boolean; insertThrows?: boolean } = {}) {
  const inserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("admin.operator_notices")) {
      inserts.push(params);
      if (opts.insertThrows) throw new Error("42501 permission denied");
      return { rows: [{ id: "notice-1" }], rowCount: 1 };
    }
    if (sql.includes("tenancy.workspaces")) {
      return opts.subject === false
        ? { rows: [], rowCount: 0 }
        : {
            rows: [
              {
                tenant_no: "2000000107",
                tenant_name: "示例科技",
                workspace_name: "默认空间",
                product_code: "karda",
                product_name: "Karda",
              },
            ],
            rowCount: 1,
          };
    }
    // 审计写钩子（fire-and-forget）落这里。
    return { rows: [], rowCount: 0 };
  });
  return { pool: query, inserts };
}

function routerWithPool(
  aggregator: Record<string, unknown>,
  poolQuery: ReturnType<typeof vi.fn>,
): IamRouter {
  const none = undefined as never;
  return new IamRouter(
    aggregator as never,
    { query: poolQuery } as unknown as Pool,
    none,
    none,
    none,
  );
}

const seatLimitAggregator = () => ({
  grantProductSeatScoped: vi.fn(async () => ({
    ok: false as const,
    reason: "seat_limit_reached" as const,
  })),
});

describe("产品席位：满了要在运营台留一条", () => {
  it("写一条 info 通告：admin 平面、链接走 tenant_no、去重键一天一条", async () => {
    const { pool, inserts } = seatPool();
    const router = routerWithPool(seatLimitAggregator(), pool);
    await expect(
      router.grantProductSeat(req(), WS, {
        productId: PRODUCT,
        userId: MEMBER,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inserts).toHaveLength(1);
    const [planes, severity, title, body, link, refType, refId] = inserts[0]!;
    expect(planes).toEqual(["admin"]);
    expect(severity).toBe("info");
    /* 租户码上屏必须带 T-（@shared 的 formatPrincipalNo）：三种主体码都是十位纯数字。 */
    expect(String(title)).toBe(
      "产品席位已满：示例科技（T-2000000107） · Karda（karda）",
    );
    expect(String(body)).toContain("默认空间");
    expect(link).toBe("/tenants/2000000107");
    expect(refType).toBe("ops_signal");
    expect(String(refId)).toMatch(
      /^seat_limit:2000000107:karda:\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("通告写炸了：客户拿到的仍然是那个 409", async () => {
    const { pool, inserts } = seatPool({ insertThrows: true });
    const router = routerWithPool(seatLimitAggregator(), pool);
    await expect(
      router.grantProductSeat(req(), WS, {
        productId: PRODUCT,
        userId: MEMBER,
      }),
    ).rejects.toMatchObject({ message: "seat_limit_reached" });
    expect(inserts).toHaveLength(1);
  });

  it("可视码解析不到也照发，只是不给一个点开 404 的链接", async () => {
    const { pool, inserts } = seatPool({ subject: false });
    const router = routerWithPool(seatLimitAggregator(), pool);
    await expect(
      router.grantProductSeat(req(), WS, {
        productId: PRODUCT,
        userId: MEMBER,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(String(inserts[0]![2])).toContain("（租户未知）");
    expect(inserts[0]![4]).toBeNull();
    expect(String(inserts[0]![6])).toContain("seat_limit:unknown:unknown:");
  });

  it("其余三种拒因不写通告（它们不是「该升档」的信号）", async () => {
    for (const reason of [
      "already_granted",
      "product_not_covered",
      "not_a_member",
    ] as const) {
      const { pool, inserts } = seatPool();
      const router = routerWithPool(
        {
          grantProductSeatScoped: vi.fn(async () => ({
            ok: false as const,
            reason,
          })),
        },
        pool,
      );
      await expect(
        router.grantProductSeat(req(), WS, {
          productId: PRODUCT,
          userId: MEMBER,
        }),
      ).rejects.toThrow();
      expect(inserts).toHaveLength(0);
    }
  });

  it("composeSeatLimitNotice 不把 uuid 写进标题、正文或链接", () => {
    const notice = composeSeatLimitNotice({
      tenantNo: "2000000107",
      tenantName: "示例科技",
      workspaceName: "默认空间",
      productCode: "karda",
      productName: "Karda",
      dayKey: "2026-09-28",
      now: new Date("2026-09-28T12:00:00.000Z"),
    });
    for (const text of [notice.title, notice.body, notice.link ?? ""]) {
      expect(text).not.toContain(WS);
      expect(text).not.toContain(PRODUCT);
      expect(text).not.toContain(MEMBER);
    }
    /* 去重键里仍是裸号：键不上屏，而 admin 的详情路由也吃裸号。 */
    expect(notice.referenceId).toBe("seat_limit:2000000107:karda:2026-09-28");
    expect(notice.expiresAt!.getTime()).toBe(
      new Date("2026-09-28T12:00:00.000Z").getTime() + 30 * 24 * 60 * 60 * 1000,
    );
  });

  /*
   * 「一天一条」的那个「天」按 Asia/Shanghai 算。按 UTC 算的话，北京 08:00 之前撞上限
   * 写的那一条落进前一天那格——同一个租户同一个产品在 00:00–08:00 与 08:00 之后各播
   * 一条，而看这块板的人在北京。这条差别只在每天那八小时里现形，所以必须钉死时刻。
   */
  it("日期键按北京日历日：北京 00:30（UTC 前一天 16:30）算新的一天", () => {
    expect(seatNoticeDayKey(new Date("2026-09-27T16:30:00.000Z"))).toBe(
      "2026-09-28",
    );
    // 北京 08:00 整（UTC 00:00）算当天，不算前一天——UTC 口径正是在这里错的。
    expect(seatNoticeDayKey(new Date("2026-09-28T00:00:00.000Z"))).toBe(
      "2026-09-28",
    );
    // 北京 23:59:59.999 还是同一天，再一毫秒才换格。
    expect(seatNoticeDayKey(new Date("2026-09-28T15:59:59.999Z"))).toBe(
      "2026-09-28",
    );
    expect(seatNoticeDayKey(new Date("2026-09-28T16:00:00.000Z"))).toBe(
      "2026-09-29",
    );
  });

  it("真路径也用它：UTC 09-30 16:30 写的通告键是 10-01（不是 09-30）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T16:30:00.000Z"));
    try {
      const { pool, inserts } = seatPool();
      const router = routerWithPool(seatLimitAggregator(), pool);
      await expect(
        router.grantProductSeat(req(), WS, {
          productId: PRODUCT,
          userId: MEMBER,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      const refId = String(inserts[0]![6]);
      expect(refId).toBe("seat_limit:2000000107:karda:2026-10-01");
    } finally {
      vi.useRealTimers();
    }
  });
});
