/**
 * platform-credit-rates.router.spec.ts —— ADR-014 PR1：费率读写口 + 不可改生效窗口语义。
 *
 * 分两层钉：
 *  · 服务层用按 SQL 片段分派的桩池（与 token-usage.service.spec 同手法），钉「新建是先关同
 *    作用域旧行、再插新行」「23505 转成冲突错」「关闭命不中回 null」。
 *  · router 层用桩服务，钉输入校验（负数/非整数/超长 → 400）与错误映射（冲突 → 409）。
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  CreditRateConflictError,
  CreditRatesService,
  type CreditRateRow,
} from "../platform/credit-rates.service";
import { PlatformCreditRatesRouter } from "./platform-credit-rates.router";

const CREATED: CreditRateRow = {
  id: "11111111-1111-4111-8111-111111111111",
  provider_code: "deepseek",
  model_code: "deepseek/v4",
  input_micro_per_1k: "33333",
  output_micro_per_1k: "133333",
  cache_write_micro_per_1k: "33333",
  cache_read_micro_per_1k: "3333",
  rerank_micro_per_candidate: "0",
  parse_micro_per_page: "0",
  effective_from: "2026-10-06T00:00:00.000Z",
  effective_to: null,
  note: null,
  created_by: null,
  created_at: "2026-10-06T00:00:00.000Z",
};

function fakePool(opts: {
  closedId?: string | null;
  insertCode?: string;
  listRows?: CreditRateRow[];
  closeRows?: CreditRateRow[];
}): { pool: Pool; calls: { sql: string; params?: unknown[] | undefined }[] } {
  const calls: { sql: string; params?: unknown[] | undefined }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/^\s*begin/i.test(sql)) return {};
      if (/^\s*commit/i.test(sql)) return {};
      if (/^\s*rollback/i.test(sql)) return {};
      if (/update metering\.token_credit_rates/i.test(sql)) {
        return { rows: opts.closedId ? [{ id: opts.closedId }] : [] };
      }
      if (/insert into metering\.token_credit_rates/i.test(sql)) {
        if (opts.insertCode) {
          throw Object.assign(new Error("dup"), { code: opts.insertCode });
        }
        return { rows: [CREATED] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (/update metering\.token_credit_rates/i.test(sql)) {
        return { rows: opts.closeRows ?? [] };
      }
      return { rows: opts.listRows ?? [] };
    }),
  } as unknown as Pool;
  return { pool, calls };
}

const baseCreate = {
  providerCode: "deepseek",
  modelCode: "deepseek/v4",
  inputMicroPer1k: "33333",
  outputMicroPer1k: "133333",
  cacheWriteMicroPer1k: "33333",
  cacheReadMicroPer1k: "3333",
  rerankMicroPerCandidate: "0",
  parseMicroPerPage: "0",
  effectiveFrom: new Date("2026-10-06T00:00:00.000Z"),
  note: null,
  createdBy: null,
};

describe("CreditRatesService", () => {
  it("新建：先关同作用域旧行、再插新行，回 closedId", async () => {
    const { pool, calls } = fakePool({ closedId: "old-row-id" });
    const svc = new CreditRatesService(pool);
    const res = await svc.create(baseCreate);

    expect(res.created.id).toBe(CREATED.id);
    expect(res.closedId).toBe("old-row-id");
    /* 事务顺序：begin → update(关旧) → insert(新) → commit。 */
    const seq = calls.map((c) => c.sql.trim().slice(0, 6).toLowerCase());
    expect(seq).toEqual(["begin", "update", "insert", "commit"]);
    /* 关旧行用 (provider, model, effectiveFrom)。 */
    const upd = calls.find((c) => /update/i.test(c.sql))!;
    expect(upd.params).toEqual([
      "deepseek",
      "deepseek/v4",
      baseCreate.effectiveFrom,
    ]);
  });

  it("新建：同作用域同生效时刻撞唯一索引 → CreditRateConflictError + rollback", async () => {
    const { pool, calls } = fakePool({ insertCode: "23505" });
    const svc = new CreditRatesService(pool);
    await expect(svc.create(baseCreate)).rejects.toBeInstanceOf(
      CreditRateConflictError,
    );
    expect(calls.some((c) => /^\s*rollback/i.test(c.sql))).toBe(true);
  });

  it("关闭：命中回行；命不中（已关/不存在）回 null", async () => {
    const hit = fakePool({ closeRows: [{ ...CREATED, effective_to: "x" }] });
    expect(
      await new CreditRatesService(hit.pool).close(CREATED.id, new Date()),
    ).not.toBeNull();

    const miss = fakePool({ closeRows: [] });
    expect(
      await new CreditRatesService(miss.pool).close(CREATED.id, new Date()),
    ).toBeNull();
  });

  it("列表：includeHistory=false 时只查当下生效窗口", async () => {
    const { pool, calls } = fakePool({ listRows: [CREATED] });
    await new CreditRatesService(pool).list({ includeHistory: false });
    const sel = calls.find((c) => /select/i.test(c.sql))!;
    expect(sel.sql).toMatch(/effective_to is null or effective_to > now\(\)/i);
  });
});

/** 桩服务，只钉 router 的校验与错误映射。 */
function stubService(
  over: Partial<CreditRatesService> = {},
): CreditRatesService {
  return {
    list: vi.fn(async () => [CREATED]),
    create: vi.fn(async () => ({ created: CREATED, closedId: null })),
    close: vi.fn(async () => CREATED),
    ...over,
  } as unknown as CreditRatesService;
}

const body = (over: Record<string, unknown> = {}) => ({
  provider_code: "deepseek",
  model_code: "deepseek/v4",
  input_micro_per_1k: 33333,
  output_micro_per_1k: 133333,
  cache_write_micro_per_1k: 33333,
  cache_read_micro_per_1k: 3333,
  ...over,
});

describe("PlatformCreditRatesRouter", () => {
  it("新建：合法体落库，rerank/parse 缺省补 0", async () => {
    const svc = stubService();
    const router = new PlatformCreditRatesRouter(svc);
    const res = await router.create(body());
    expect(res.created.id).toBe(CREATED.id);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({
        rerankMicroPerCandidate: "0",
        parseMicroPerPage: "0",
        providerCode: "deepseek",
      }),
    );
  });

  it("校验：负数/非整数/超长作用域 → 400", async () => {
    const router = new PlatformCreditRatesRouter(stubService());
    await expect(
      router.create(body({ input_micro_per_1k: -1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      router.create(body({ output_micro_per_1k: "1.5" })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      router.create(body({ model_code: "x".repeat(129) })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("新建：服务抛冲突 → 409", async () => {
    const svc = stubService({
      create: vi.fn(async () => {
        throw new CreditRateConflictError("dup");
      }),
    });
    await expect(
      new PlatformCreditRatesRouter(svc).create(body()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("关闭：命不中 → 409", async () => {
    const svc = stubService({ close: vi.fn(async () => null) });
    await expect(
      new PlatformCreditRatesRouter(svc).close("missing", {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("空作用域（通配默认档）：provider/model 空串 → null", async () => {
    const svc = stubService();
    await new PlatformCreditRatesRouter(svc).create(
      body({ provider_code: "", model_code: "" }),
    );
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ providerCode: null, modelCode: null }),
    );
  });
});
