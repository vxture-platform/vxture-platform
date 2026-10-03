/**
 * token-usage.service.spec.ts —— 原始 token 用量接收：换算、结转、三种不扣、两段事务与自愈（#547）。
 *
 * 池按 SQL 片段分派的桩（与 platform-usage.service.spec 同一手法）。引擎是桩：这里钉的是
 * 「什么时候该叫它、叫它扣多少、叫不动时原始事实还在不在」，不是引擎自己的瀑布。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { ConsumeService } from "@vxture/service-subscription";
import {
  creditsFor,
  splitCarry,
  TokenUsageService,
  type TokenUsageInput,
} from "./token-usage.service";

const WS = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";
const RATE_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";

/** 默认档：2K tokens = 1 credit ⇒ 每 1K token 500,000 微。 */
const DEFAULT_RATE = {
  id: RATE_ID,
  input_micro_per_1k: "500000",
  output_micro_per_1k: "500000",
  cache_write_micro_per_1k: "500000",
  cache_read_micro_per_1k: "500000",
  rerank_micro_per_candidate: "0",
  parse_micro_per_page: "0",
};

function baseInput(over: Partial<TokenUsageInput> = {}): TokenUsageInput {
  return {
    workspaceId: WS,
    productId: PRODUCT_ID,
    productCode: "karda",
    requestId: "req-1",
    attemptIndex: 0,
    outcome: "served",
    occurredAt: new Date("2026-10-04T08:00:00.000Z"),
    modelCode: "doubao-pro",
    providerCode: "volcengine",
    tokens: { input: 1000n, output: 1000n, cacheWrite: 0n, cacheRead: 0n },
    backfill: false,
    ...over,
  };
}

/**
 * 一只池装整条路径：幂等占位 / 费率 / 结转 / 原始行 / 回填。
 * opts.claimed=true 模拟同键已存在（重放）；opts.carry 是结转表里现有余额；opts.rate=null 模拟没费率。
 */
function fakePool(
  opts: {
    claimed?: boolean;
    prev?: Record<string, unknown>;
    carry?: string;
    rate?: typeof DEFAULT_RATE | null;
  } = {},
) {
  const calls: { sql: string; params: unknown[] }[] = [];
  // impl 单独具名：测试要在它外面包一层（某条 SQL 抛错）时拿这个引用，而不是
  // query.getMockImplementation() —— 后者在排了 mockImplementationOnce 之后回的是那个 once，
  // 包上去等于把整条路径都换成了「回空行」，占位就变成了重放。
  const impl = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (/^(begin|commit|rollback)$/i.test(sql.trim()))
      return { rows: [], rowCount: 0 };
    if (sql.includes("insert into metering.token_usage_idempotencies")) {
      return opts.claimed
        ? { rows: [], rowCount: 0 }
        : { rows: [{ request_id: "req-1" }], rowCount: 1 };
    }
    if (
      sql.includes("from metering.token_usage_idempotencies") &&
      sql.includes("for share")
    ) {
      return { rows: [opts.prev ?? {}], rowCount: 1 };
    }
    if (sql.includes("from metering.token_credit_rates")) {
      const r = opts.rate === undefined ? DEFAULT_RATE : opts.rate;
      return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
    }
    if (sql.includes("insert into metering.token_credit_carry"))
      return { rows: [], rowCount: 1 };
    if (sql.includes("from metering.token_credit_carry")) {
      return { rows: [{ carry_micro: opts.carry ?? "0" }], rowCount: 1 };
    }
    if (sql.includes("update metering.token_credit_carry"))
      return { rows: [], rowCount: 1 };
    if (sql.includes("insert into metering.token_usage_events")) {
      return {
        rows: [
          { id: EVENT_ID, created_at: new Date("2026-10-04T08:00:01.000Z") },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("update metering.token_usage_idempotencies"))
      return { rows: [], rowCount: 1 };
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  };
  const query = vi.fn(impl);
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { connect: vi.fn(async () => client), query } as unknown as Pool;
  return { pool, calls, query, impl };
}

function fakeEngine(opts: { throws?: boolean; eventId?: string | null } = {}) {
  const consume = vi.fn(async (input: { amount: string }) => {
    if (opts.throws) throw new Error("engine unreachable");
    return {
      status: "ok" as const,
      consumed: input.amount,
      perPool: [{ poolId: "p1", took: input.amount }],
      replayed: false,
      ...(opts.eventId === null
        ? {}
        : { eventId: opts.eventId ?? "usage-evt-1" }),
    };
  });
  return { consume } as unknown as ConsumeService & { consume: typeof consume };
}

const carryUpdateOf = (calls: { sql: string; params: unknown[] }[]) =>
  calls.find((c) => c.sql.includes("update metering.token_credit_carry"));
const eventInsertOf = (calls: { sql: string; params: unknown[] }[]) =>
  calls.find((c) => c.sql.includes("insert into metering.token_usage_events"));

describe("creditsFor —— 四维 + 单位计价，BigInt 整除", () => {
  const rate = {
    inputMicroPer1k: 500_000n,
    outputMicroPer1k: 500_000n,
    cacheWriteMicroPer1k: 500_000n,
    cacheReadMicroPer1k: 500_000n,
    rerankMicroPerCandidate: 0n,
    parseMicroPerPage: 0n,
  };
  it("2K tokens = 1 credit（product_220 §4.2 基线）", () => {
    expect(
      creditsFor(
        { input: 1000n, output: 1000n, cacheWrite: 0n, cacheRead: 0n },
        rate,
      ),
    ).toBe(1_000_000n);
  });
  it("四维分别计价、互不重叠地相加", () => {
    const r = {
      ...rate,
      cacheReadMicroPer1k: 50_000n,
      cacheWriteMicroPer1k: 625_000n,
    };
    // 1000 in + 1000 out + 1000 cw + 1000 cr = 500000 + 500000 + 625000 + 50000
    expect(
      creditsFor(
        { input: 1000n, output: 1000n, cacheWrite: 1000n, cacheRead: 1000n },
        r,
      ),
    ).toBe(1_675_000n);
  });
  it("rerank 候选 / parse 页按单位计，不除以 1000", () => {
    const r = {
      ...rate,
      rerankMicroPerCandidate: 1_000n,
      parseMicroPerPage: 20_000n,
    };
    expect(
      creditsFor({ input: 0n, output: 0n, cacheWrite: 0n, cacheRead: 0n }, r, {
        rerankCandidates: 100,
        parsePages: 3,
      }),
    ).toBe(100_000n + 60_000n);
  });
  it("500 token 是 0.25 credit（这就是为什么要结转）", () => {
    expect(
      creditsFor(
        { input: 500n, output: 0n, cacheWrite: 0n, cacheRead: 0n },
        rate,
      ),
    ).toBe(250_000n);
  });
});

describe("splitCarry —— 小数攒着，满 1 才扣", () => {
  it("四次 0.25 credit：前三次扣 0，第四次扣 1，余额回到 0", () => {
    let carry = 0n;
    const wholes: bigint[] = [];
    for (let i = 0; i < 4; i += 1) {
      const s = splitCarry(carry, 250_000n);
      wholes.push(s.whole);
      carry = s.carry;
    }
    expect(wholes).toEqual([0n, 0n, 0n, 1n]);
    expect(carry).toBe(0n);
  });
  it("一次 2.7 credit 带着 0.5 余额：扣 3，留 0.2", () => {
    expect(splitCarry(500_000n, 2_700_000n)).toEqual({
      whole: 3n,
      carry: 200_000n,
    });
  });
  it("余额永远落在 [0, 1e6)", () => {
    const s = splitCarry(999_999n, 999_999n);
    expect(s.carry).toBeGreaterThanOrEqual(0n);
    expect(s.carry).toBeLessThan(1_000_000n);
  });
});

describe("TokenUsageService.ingest —— served 路径", () => {
  it("2000 token ⇒ 1 credit：写原始行、结转归零、叫引擎扣 ai.credit 1 个、回填 usage_event_id", async () => {
    const { pool, calls } = fakePool();
    const engine = fakeEngine();
    const svc = new TokenUsageService(pool, engine);
    const r = await svc.ingest(baseInput());

    expect(r.tokenEventId).toBe(EVENT_ID);
    expect(r.creditsMicro).toBe(1_000_000n);
    expect(r.creditSkipReason).toBeNull();
    expect(r.wholeDue).toBe(1n);
    expect(r.usageEventId).toBe("usage-evt-1");
    expect(r.replayed).toBe(false);
    expect(r.settleFailed).toBe(false);

    expect(engine.consume).toHaveBeenCalledTimes(1);
    expect(engine.consume.mock.calls[0]![0]).toMatchObject({
      workspaceId: WS,
      productId: PRODUCT_ID,
      metricKey: "ai.credit",
      amount: "1",
      idempotencyKey: "tok:req-1:0",
      requestId: "req-1",
      intent: "report",
    });
    // 原始行记的是四维与费率 id，credits_micro 带值、skip 为空
    const ins = eventInsertOf(calls)!;
    expect(ins.params.slice(8, 12)).toEqual(["1000", "1000", "0", "0"]);
    expect(ins.params[15]).toBe("1000000");
    expect(ins.params[16]).toBeNull();
    expect(ins.params[17]).toBe(RATE_ID);
    // 结转：0 + 1,000,000 ⇒ whole 1、carry 0
    expect(carryUpdateOf(calls)!.params[2]).toBe("0");
    // 回填把 usage_event_id 写进幂等行
    const backfill = calls.find((c) => c.sql.includes("set usage_event_id"));
    expect(backfill!.params[4]).toBe("usage-evt-1");
  });

  it("500 token（0.25 credit）：只进结转，不叫引擎；带 0.9 余额时进位扣 1、留 0.15", async () => {
    const a = fakePool();
    const engineA = fakeEngine();
    const ra = await new TokenUsageService(a.pool, engineA).ingest(
      baseInput({
        tokens: { input: 500n, output: 0n, cacheWrite: 0n, cacheRead: 0n },
      }),
    );
    expect(ra.creditsMicro).toBe(250_000n);
    expect(ra.wholeDue).toBe(0n);
    expect(ra.usageEventId).toBeNull();
    expect(engineA.consume).not.toHaveBeenCalled();
    expect(carryUpdateOf(a.calls)!.params[2]).toBe("250000");

    const b = fakePool({ carry: "900000" });
    const engineB = fakeEngine();
    const rb = await new TokenUsageService(b.pool, engineB).ingest(
      baseInput({
        tokens: { input: 500n, output: 0n, cacheWrite: 0n, cacheRead: 0n },
      }),
    );
    expect(rb.wholeDue).toBe(1n);
    expect(engineB.consume.mock.calls[0]![0]).toMatchObject({ amount: "1" });
    expect(carryUpdateOf(b.calls)!.params[2]).toBe("150000");
  });

  it("费率选行把 provider / model / occurred_at 都传进去（精确档优先的判据在 SQL 里）", async () => {
    const { pool, calls } = fakePool();
    await new TokenUsageService(pool, fakeEngine()).ingest(baseInput());
    const pick = calls.find((c) =>
      c.sql.includes("from metering.token_credit_rates"),
    )!;
    expect(pick.params).toEqual([
      "volcengine",
      "doubao-pro",
      new Date("2026-10-04T08:00:00.000Z"),
    ]);
    expect(pick.sql).toMatch(
      /order by \(model_code is not null\) desc, \(provider_code is not null\) desc/,
    );
  });
});

describe("三种不扣（owner 2026-10-03）—— 原始行照记，不查费率、不碰结转、不叫引擎", () => {
  for (const [name, over, reason] of [
    ["故障转移里失败的尝试", { outcome: "failed" as const }, "failed_attempt"],
    ["补报历史", { backfill: true }, "pre_cutover"],
  ] as const) {
    it(`${name} ⇒ credit_skip_reason=${reason}`, async () => {
      const { pool, calls } = fakePool();
      const engine = fakeEngine();
      const r = await new TokenUsageService(pool, engine).ingest(
        baseInput(over),
      );
      expect(r.creditsMicro).toBeNull();
      expect(r.creditSkipReason).toBe(reason);
      expect(r.wholeDue).toBe(0n);
      expect(engine.consume).not.toHaveBeenCalled();
      expect(calls.some((c) => c.sql.includes("token_credit_rates"))).toBe(
        false,
      );
      expect(carryUpdateOf(calls)).toBeUndefined();
      const ins = eventInsertOf(calls)!;
      expect(ins.params[15]).toBeNull();
      expect(ins.params[16]).toBe(reason);
    });
  }

  it("发生时刻没有任何生效费率 ⇒ no_rate：配置缺口不是客户的错，照记不扣", async () => {
    const { pool, calls } = fakePool({ rate: null });
    const engine = fakeEngine();
    const r = await new TokenUsageService(pool, engine).ingest(baseInput());
    expect(r.creditSkipReason).toBe("no_rate");
    expect(r.creditsMicro).toBeNull();
    expect(engine.consume).not.toHaveBeenCalled();
    expect(eventInsertOf(calls)!.params[17]).toBeNull();
  });
});

describe("两段事务：引擎叫不动时原始事实已提交，待同键重放自愈", () => {
  it("引擎抛错 ⇒ 不抛给调用方；commit 已发生；usage_event_id 空；settleFailed=true", async () => {
    const { pool, calls } = fakePool();
    const svc = new TokenUsageService(pool, fakeEngine({ throws: true }));
    const r = await svc.ingest(baseInput());
    expect(r.tokenEventId).toBe(EVENT_ID);
    expect(r.wholeDue).toBe(1n);
    expect(r.usageEventId).toBeNull();
    expect(r.settleFailed).toBe(true);
    const seq = calls.map((c) => c.sql.trim().toLowerCase());
    expect(seq.filter((s) => s === "commit")).toHaveLength(1);
    expect(seq).not.toContain("rollback");
    expect(calls.some((c) => c.sql.includes("set usage_event_id"))).toBe(false);
  });

  it("重放：同键再来 ⇒ 回先前结果，不再写原始行；若当时没扣成（usage_event_id 空、whole_due>0）就再叫一次引擎", async () => {
    const { pool, calls } = fakePool({
      claimed: true,
      prev: {
        token_event_id: EVENT_ID,
        credits_micro: "1000000",
        credit_skip_reason: null,
        whole_due: "1",
        usage_event_id: null,
      },
    });
    const engine = fakeEngine();
    const r = await new TokenUsageService(pool, engine).ingest(baseInput());
    expect(r.replayed).toBe(true);
    expect(r.tokenEventId).toBe(EVENT_ID);
    expect(r.creditsMicro).toBe(1_000_000n);
    expect(r.usageEventId).toBe("usage-evt-1");
    expect(engine.consume).toHaveBeenCalledTimes(1);
    expect(engine.consume.mock.calls[0]![0]).toMatchObject({
      idempotencyKey: "tok:req-1:0",
    });
    expect(eventInsertOf(calls)).toBeUndefined();
  });

  it("重放：当时已经扣成 ⇒ 不再叫引擎，原样回", async () => {
    const { pool } = fakePool({
      claimed: true,
      prev: {
        token_event_id: EVENT_ID,
        credits_micro: "250000",
        credit_skip_reason: null,
        whole_due: "0",
        usage_event_id: null,
      },
    });
    const engine = fakeEngine();
    const r = await new TokenUsageService(pool, engine).ingest(baseInput());
    expect(r.replayed).toBe(true);
    expect(r.wholeDue).toBe(0n);
    expect(engine.consume).not.toHaveBeenCalled();
  });

  it("原始行写不进去 ⇒ rollback 并抛（这一步失败不该留下半截幂等占位）", async () => {
    const { pool, query, impl } = fakePool();
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("insert into metering.token_usage_events"))
        throw new Error("23514 check_violation");
      return impl(sql, params);
    });
    const engine = fakeEngine();
    await expect(
      new TokenUsageService(pool, engine).ingest(baseInput()),
    ).rejects.toThrow("23514");
    expect(engine.consume).not.toHaveBeenCalled();
    const seq = query.mock.calls.map((c) => String(c[0]).trim().toLowerCase());
    expect(seq).toContain("rollback");
  });
});
