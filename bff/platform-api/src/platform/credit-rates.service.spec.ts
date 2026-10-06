/**
 * credit-rates.service.spec.ts —— ADR-014 PR1：费率写的核心语义（不可改生效窗口）。
 *
 * 用按 SQL 片段分派的桩池（与 token-usage.service.spec 同手法），钉住本服务唯一要保证的
 * 几件事：新建是「一个事务里先关同作用域旧行、再插新行」；同作用域同生效时刻撞唯一索引时
 * 转成冲突错并回滚；关闭命中回行、命不中回 null；列表默认只查当下生效窗口。
 *
 * HTTP 暴露与鉴权**不在本 PR**：费率写必须是运营/admin 面的凭据（PlatformAuthGuard 认的是
 * 任意产品 S2S 调用方，拿它当门会让任何产品改价），那条 admin-bff → platform-api 通道随
 * admin 换算面一起落（ADR-014 D5 / 后果）。所以这里只钉 DB 写语义，端点留到 admin PR。
 */
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  CreditRateConflictError,
  CreditRatesService,
  type CreditRateRow,
} from "./credit-rates.service";

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
  it("新建：一个事务里先关同作用域旧行、再插新行，回 closedId", async () => {
    const { pool, calls } = fakePool({ closedId: "old-row-id" });
    const res = await new CreditRatesService(pool).create(baseCreate);

    expect(res.created.id).toBe(CREATED.id);
    expect(res.closedId).toBe("old-row-id");
    const seq = calls.map((c) => c.sql.trim().slice(0, 6).toLowerCase());
    expect(seq).toEqual(["begin", "update", "insert", "commit"]);
    const upd = calls.find((c) => /update/i.test(c.sql))!;
    expect(upd.params).toEqual([
      "deepseek",
      "deepseek/v4",
      baseCreate.effectiveFrom,
    ]);
  });

  it("新建：同作用域同生效时刻撞唯一索引 → CreditRateConflictError + rollback", async () => {
    const { pool, calls } = fakePool({ insertCode: "23505" });
    await expect(
      new CreditRatesService(pool).create(baseCreate),
    ).rejects.toBeInstanceOf(CreditRateConflictError);
    expect(calls.some((c) => /^\s*rollback/i.test(c.sql))).toBe(true);
  });

  it("新建：没有旧行时 closedId 为 null，仍插入成功", async () => {
    const { pool } = fakePool({ closedId: null });
    const res = await new CreditRatesService(pool).create(baseCreate);
    expect(res.closedId).toBeNull();
    expect(res.created.id).toBe(CREATED.id);
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

  it("列表：includeHistory=false 只查当下生效窗口；true 不加窗口过滤", async () => {
    const off = fakePool({ listRows: [CREATED] });
    await new CreditRatesService(off.pool).list({ includeHistory: false });
    expect(off.calls.find((c) => /select/i.test(c.sql))!.sql).toMatch(
      /effective_to is null or effective_to > now\(\)/i,
    );

    const all = fakePool({ listRows: [CREATED] });
    await new CreditRatesService(all.pool).list({ includeHistory: true });
    expect(all.calls.find((c) => /select/i.test(c.sql))!.sql).not.toMatch(
      /effective_from <= now\(\)/i,
    );
  });
});
