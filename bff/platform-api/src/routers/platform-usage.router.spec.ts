/**
 * platform-usage.router.spec.ts —— gated 那一刻要留下一条运营通告，而它不许改变这次响应
 * （2026-09-28 第二批 C-2）。
 *
 * 这条路的两个坏法都不会有外在症状：
 *   · 不写 —— 客户的配额早就不够了，运营台一片安静（owner 2026-09-28「信息做全做多」）。
 *   · 写炸了却影响响应 —— 扣减已经落库，调用方却收到 5xx，它会以为用量没记上并重试。
 *     幂等键挡得住重复扣减，但那次调用在它那边是「失败」，而事实上不是。
 * 所以这里钉的是：gated 才写、写什么、以及写路径抛异常时响应体逐字不变。
 */
import { describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import type { PlatformUsageService } from "../platform/platform-usage.service";
import type { TokenUsageService } from "../platform/token-usage.service";
import type { PoolIdentity } from "../platform/usage-view";
import { PlatformUsageRouter } from "./platform-usage.router";

const WS = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

const pools: PoolIdentity[] = [
  {
    poolId: "p1",
    subscriptionId: "sub-1",
    view: {
      metric: "doc.words",
      limit: 1000,
      remaining: 12,
      priority: 10,
      enforcement: "soft",
    },
    periodStart: new Date("2026-09-20T00:00:00.000Z"),
  },
];

const body = {
  workspace_id: WS,
  product: "karda",
  metric: "doc.words",
  amount: 500,
  idempotency_key: "idem-1",
};

function res(): Response & { status: ReturnType<typeof vi.fn> } {
  const status = vi.fn();
  return { status } as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
  };
}

function routerWith(opts: {
  status: "ok" | "insufficient" | "denied";
  noteThrows?: boolean;
}) {
  // 参数带上类型，mock.calls 才有形状可断言（vi.fn(async () => …) 的 calls 是 [][]）。
  const noteQuotaExhausted = vi.fn(
    async (
      _input: Parameters<PlatformUsageService["noteQuotaExhausted"]>[0],
    ) => {
      if (opts.noteThrows) throw new Error("notice writer exploded");
    },
  );
  const usage = {
    resolveProductId: vi.fn(async () => PRODUCT_ID),
    isGaugeMetric: vi.fn(async () => false),
    consume: vi.fn(async () => ({
      status: opts.status,
      // denied = 什么都没扣、什么都没写，所以明细也是空的（引擎在写之前就回滚了）。
      consumed:
        opts.status === "ok" ? "500" : opts.status === "denied" ? "0" : "12",
      perPool: opts.status === "denied" ? [] : [{ poolId: "p1", took: "12" }],
      replayed: false,
    })),
    readPools: vi.fn(async () => pools),
    noteQuotaExhausted,
  };
  const router = new PlatformUsageRouter(
    usage as unknown as PlatformUsageService,
    // token 形态在本 spec 里不走；形状上要给一个（ingest 被叫到就是错的）
    {
      ingest: vi.fn(async () => {
        throw new Error("tokens path must not run here");
      }),
    } as unknown as TokenUsageService,
  );
  return { router, usage, noteQuotaExhausted };
}

describe("POST /usage/consume —— gated 时的运营通告", () => {
  it("gated：按工作空间 / 产品码 / 指标 / 本次量 / 池状态上报一次", async () => {
    const { router, noteQuotaExhausted } = routerWith({
      status: "insufficient",
    });
    const out = await router.consume(body, res());
    expect(out.gated).toBe(true);
    expect(noteQuotaExhausted).toHaveBeenCalledTimes(1);
    expect(noteQuotaExhausted.mock.calls[0]![0]).toEqual({
      workspaceId: WS,
      productCode: "karda",
      metric: "doc.words",
      amount: "500",
      remainingTotal: 12,
      pools,
      /* 这一档是 insufficient（200，照记），所以 denied 为假——通告正文按它分两档。 */
      denied: false,
    });
  });

  /*
   * 预留被拒（intent=reserve + 硬限）那一档。三件事在这一层才看得见：
   *   ① 409 真的走到了 res.status —— buildConsumeResponse 算出来的状态码若没被接上，
   *      调用方收到的仍是 200，而它问的是「能不能做」，于是它会去做。
   *   ② 通告照发，并且带上 denied —— 运营侧那段文案按它分两档（说「拒了」还是说「仍是 200」）。
   *   ③ 仍然是一条，不是因为换了档就改成每次一条。
   */
  it("denied：409 接到响应上，通告带 denied 且只发一条", async () => {
    const { router, noteQuotaExhausted } = routerWith({ status: "denied" });
    const r = res();
    const out = await router.consume(body, r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(out.gated).toBe(true);
    expect(out.enforcement).toBe("hard");
    expect(out.consumed).toBe(0);
    expect(out.per_pool_breakdown).toEqual([]);
    expect(noteQuotaExhausted).toHaveBeenCalledTimes(1);
    expect(noteQuotaExhausted.mock.calls[0]![0]!.denied).toBe(true);
  });

  it("insufficient：状态码仍是 200（2026-08-10 那条裁定管的是这一档）", async () => {
    const { router } = routerWith({ status: "insufficient" });
    const r = res();
    await router.consume(body, r);
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it("没 gated：一条都不写（配额覆盖住了不是信号）", async () => {
    const { router, noteQuotaExhausted } = routerWith({ status: "ok" });
    const out = await router.consume(body, res());
    expect(out.gated).toBe(false);
    expect(noteQuotaExhausted).not.toHaveBeenCalled();
  });

  it("通告那一步抛了：响应体逐字不变，状态码仍是 200", async () => {
    const { router } = routerWith({
      status: "insufficient",
      noteThrows: true,
    });
    const response = res();
    const out = await router.consume(body, response);
    expect(out).toEqual({
      gated: true,
      consumed: 12,
      remaining_total: 12,
      per_pool_breakdown: [
        {
          subscription_id: "sub-1",
          metric: "doc.words",
          took: 12,
          remaining: 12,
        },
      ],
      reason: "quota_exhausted",
    });
    expect(response.status).toHaveBeenCalledWith(200);
  });
});
