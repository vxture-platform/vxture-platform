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
import type { LegacyAuthUsageService } from "../platform/legacy-auth-usage.service";
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
  /** token 形态要走到 ingest 的用例才给；缺省的 ingest 一被叫到就是错的。 */
  ingest?: ReturnType<typeof vi.fn>;
  /** 归属产品不在目录（代上报的 unknown_product 用例）。 */
  unknownProduct?: boolean;
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
    resolveProductId: vi.fn(async () =>
      opts.unknownProduct ? null : PRODUCT_ID,
    ),
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
    recordGauge: vi.fn(async () => ({
      value: "7",
      observedAt: new Date("2026-10-04T00:00:00.000Z"),
      applied: true,
    })),
  };
  const recordLegacy = vi.fn();
  const ingest =
    opts.ingest ??
    vi.fn(async () => {
      // token 形态只在代上报那几条用例里走；别处 ingest 被叫到就是错的
      throw new Error("tokens path must not run here");
    });
  const router = new PlatformUsageRouter(
    usage as unknown as PlatformUsageService,
    { ingest } as unknown as TokenUsageService,
    { record: recordLegacy } as unknown as LegacyAuthUsageService,
  );
  return { router, usage, ingest, noteQuotaExhausted, recordLegacy };
}

const S2S_KARDA = {
  productCode: "karda",
  mode: "service" as const,
  orgId: null,
  workspaceId: WS,
  delegated: false,
};

/** 代上报票（决策 3 PR C）：act.sub 是上报者 atlas，票里没有 workspace。 */
const DELEGATED_ATLAS = {
  productCode: "atlas",
  mode: "service" as const,
  orgId: null,
  workspaceId: null,
  delegated: true,
};

const WS_OTHER = "33333333-3333-4333-8333-333333333333";

/** atlas 替 tenderforge 报的一次推理（ADR-013 D2 的 token 形态）。 */
const tokenBody = {
  workspace_id: WS_OTHER,
  product: "tenderforge",
  request_id: "req-1",
  occurred_at: "2026-10-04T00:00:00.000Z",
  tokens: { input: 10, output: 5, cache_write: 0, cache_read: 0 },
};

/** ingest 的返回形状（token-usage.service.ts TokenUsageResult 里 buildTokenConsumeResponse 用到的那几格）。 */
const ingested = () => ({
  tokenEventId: "tok-1",
  creditsMicro: 7_500n,
  creditSkipReason: null,
  wholeDue: 0n,
  consume: null,
  replayed: false,
});

describe("代上报票（决策 3 PR C）—— consume 只收 token 形态，别的路一律 403", () => {
  it("token 形态：归属=自报产品、工作区=自报值、ingest 收到的是 tenderforge 不是 atlas，旧凭据不记", async () => {
    const ingest = vi.fn(async (_input: unknown) => ingested());
    const { router, usage, recordLegacy } = routerWith({
      status: "ok",
      ingest,
    });
    const r = res();
    const out = await router.consume(tokenBody, r, undefined, DELEGATED_ATLAS);
    expect(usage.resolveProductId).toHaveBeenCalledWith("tenderforge");
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0]![0]).toMatchObject({
      workspaceId: WS_OTHER,
      productId: PRODUCT_ID,
      productCode: "tenderforge",
      requestId: "req-1",
    });
    expect(usage.readPools).toHaveBeenCalledWith(
      WS_OTHER,
      PRODUCT_ID,
      "ai.credit",
    );
    expect(r.status).toHaveBeenCalledWith(200);
    expect(out).toMatchObject({ token_event_id: "tok-1", credits_micro: 7500 });
    expect(recordLegacy).not.toHaveBeenCalled();
  });

  it("token 形态 + 归属产品不在目录：400，body.message 仍是裸码 unknown_product、body.product 点名，ingest 不跑", async () => {
    const ingest = vi.fn(async () => ingested());
    const { router } = routerWith({
      status: "ok",
      ingest,
      unknownProduct: true,
    });
    await expect(
      router.consume(
        { ...tokenBody, product: "ghost" },
        res(),
        undefined,
        DELEGATED_ATLAS,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "unknown_product",
      response: {
        statusCode: 400,
        message: "unknown_product",
        product: "ghost",
      },
    });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("amount 形态（含 reserve）：403 s2s_delegated_path_not_allowed，引擎与目录都不碰", async () => {
    const { router, usage, recordLegacy } = routerWith({ status: "ok" });
    for (const b of [body, { ...body, intent: "reserve" }]) {
      await expect(
        router.consume(b, res(), undefined, DELEGATED_ATLAS),
      ).rejects.toMatchObject({ message: "s2s_delegated_path_not_allowed" });
    }
    expect(usage.resolveProductId).not.toHaveBeenCalled();
    expect(usage.consume).not.toHaveBeenCalled();
    expect(recordLegacy).not.toHaveBeenCalled();
  });

  it("gauge：403 s2s_delegated_path_not_allowed，不落库", async () => {
    const { router, usage } = routerWith({ status: "ok" });
    usage.isGaugeMetric.mockResolvedValue(true);
    await expect(
      router.gauge(
        {
          workspace_id: WS_OTHER,
          product: "tenderforge",
          metric: "storage.bytes",
          value: 7,
          observed_at: "2026-10-04T00:00:00.000Z",
        },
        DELEGATED_ATLAS,
      ),
    ).rejects.toMatchObject({ message: "s2s_delegated_path_not_allowed" });
    expect(usage.recordGauge).not.toHaveBeenCalled();
  });

  it("产品票（非 delegated）报别人的 token：仍是 403 s2s_product_mismatch——代上报档位不松动产品票", async () => {
    const ingest = vi.fn(async () => ingested());
    const { router } = routerWith({ status: "ok", ingest });
    await expect(
      router.consume(tokenBody, res(), undefined, S2S_KARDA),
    ).rejects.toMatchObject({ message: "s2s_product_mismatch" });
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe("E6 —— 旧凭据计数只在旧头那条路上", () => {
  it("consume · 旧头（无 s2sCaller）：记一笔 usage.consume，按自报产品码", async () => {
    const { router, recordLegacy } = routerWith({ status: "ok" });
    await router.consume(body, res());
    expect(recordLegacy.mock.calls.map((c) => c[0])).toEqual([
      { route: "usage.consume", productCode: "karda" },
    ]);
  });

  it("consume · Bearer 调用方在场：一笔都不记", async () => {
    const { router, recordLegacy } = routerWith({ status: "ok" });
    await router.consume(body, res(), undefined, S2S_KARDA);
    expect(recordLegacy).not.toHaveBeenCalled();
  });

  it("consume · 旧头 + intent=reserve：403 在发射点之前，所以不记（头注「看不见什么」那一条）", async () => {
    const { router, recordLegacy, usage } = routerWith({ status: "ok" });
    await expect(
      router.consume({ ...body, intent: "reserve" }, res()),
    ).rejects.toMatchObject({ message: "s2s_legacy_path_not_allowed" });
    expect(recordLegacy).not.toHaveBeenCalled();
    expect(usage.consume).not.toHaveBeenCalled();
  });

  it("gauge · 旧头：记一笔 usage.gauge；Bearer：不记", async () => {
    const { router, recordLegacy, usage } = routerWith({ status: "ok" });
    usage.isGaugeMetric.mockResolvedValue(true);
    const gaugeBody = {
      workspace_id: WS,
      product: "karda",
      metric: "storage.bytes",
      value: 7,
      observed_at: "2026-10-04T00:00:00.000Z",
    };
    await router.gauge(gaugeBody);
    expect(recordLegacy.mock.calls.map((c) => c[0])).toEqual([
      { route: "usage.gauge", productCode: "karda" },
    ]);
    await router.gauge(gaugeBody, S2S_KARDA);
    expect(recordLegacy).toHaveBeenCalledTimes(1);
  });
});

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
