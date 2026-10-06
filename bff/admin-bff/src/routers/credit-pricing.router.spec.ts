/**
 * credit-pricing.router.spec.ts —— ADR-014 PR3a：换算面读写 + 能力门 + 不可改窗口。
 *
 * 桩池按 SQL 片段分派（与仓里其它 router spec 同手法）。钉：配置读/写、费率列表、服务端推导、
 * 应用费率是「先关同作用域旧窗口、再插新行」、23505→冲突、以及两个能力门（无会话 401 / 无码 403）。
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  CreditPricingRouter,
  type CreditRateRow,
} from "./credit-pricing.router";
import type { RequestContext } from "../types/console.types";

const OPERATOR = "11111111-1111-4111-8111-111111111111";
const CONFIG = {
  anchor_micro_cny_per_credit: "200000",
  anchor: "200000", // loadConfig 的 SELECT 把列 alias 成 anchor
  target_margin_bps: 7000,
  updated_by: null,
  updated_at: "2026-10-06T00:00:00.000Z",
};
const RATE: CreditRateRow = {
  id: "22222222-2222-4222-8222-222222222222",
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
  created_by: OPERATOR,
  created_at: "2026-10-06T00:00:00.000Z",
};

function pools(opts: { insertCode?: string; closedId?: string | null } = {}): {
  ro: Pool;
  rw: Pool;
  calls: string[];
} {
  const calls: string[] = [];
  const ro = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/credit_pricing_config/i.test(sql)) return { rows: [CONFIG] };
      if (/from metering\.token_credit_rates/i.test(sql))
        return { rows: [RATE] };
      return { rows: [] };
    }),
  } as unknown as Pool;
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/update metering\.token_credit_rates/i.test(sql)) {
        return { rows: opts.closedId ? [{ id: opts.closedId }] : [] };
      }
      if (/insert into metering\.token_credit_rates/i.test(sql)) {
        if (opts.insertCode)
          throw Object.assign(new Error("dup"), { code: opts.insertCode });
        return { rows: [RATE] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  const rw = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/credit_pricing_config/i.test(sql)) return { rows: [CONFIG] };
      return { rows: [] };
    }),
  } as unknown as Pool;
  return { ro, rw, calls };
}

function req(caps: string[], user = true): Request & RequestContext {
  return {
    ...(user ? { user: { id: OPERATOR } } : {}),
    capabilities: caps,
    query: {},
  } as unknown as Request & RequestContext;
}

describe("CreditPricingRouter 能力门", () => {
  it("无会话 → 401", async () => {
    const { ro, rw } = pools();
    await expect(
      new CreditPricingRouter(ro, rw).getConfig(req([], false)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("无码 → 403", async () => {
    const { ro, rw } = pools();
    await expect(
      new CreditPricingRouter(ro, rw).getConfig(req(["commerce:order.read"])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("manage 端点只收 manage 码（read 码不够）", async () => {
    const { ro, rw } = pools();
    await expect(
      new CreditPricingRouter(ro, rw).setConfig(
        req(["pricing:credit_rate.read"]),
        {
          anchor_micro_cny_per_credit: 200000,
          target_margin_bps: 7000,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("CreditPricingRouter config", () => {
  it("getConfig 回锚价/毛利", async () => {
    const { ro, rw } = pools();
    const c = await new CreditPricingRouter(ro, rw).getConfig(
      req(["pricing:credit_rate.read"]),
    );
    expect(c.anchor_micro_cny_per_credit).toBe("200000");
    expect(c.target_margin_bps).toBe(7000);
  });
  it("setConfig 拒锚价 0 与毛利 ≥10000", async () => {
    const { ro, rw } = pools();
    const r = new CreditPricingRouter(ro, rw);
    await expect(
      r.setConfig(req(["pricing:credit_rate.manage"]), {
        anchor_micro_cny_per_credit: 0,
        target_margin_bps: 7000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      r.setConfig(req(["pricing:credit_rate.manage"]), {
        anchor_micro_cny_per_credit: 200000,
        target_margin_bps: 10000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("CreditPricingRouter derive", () => {
  it("服务端按配置逐维推导（¥0.20 / 70%）", async () => {
    const { ro, rw } = pools();
    const out = await new CreditPricingRouter(ro, rw).derive(
      req(["pricing:credit_rate.read"]),
      {
        models: [
          {
            model_code: "deepseek/v4",
            unit_tokens: 1_000_000,
            input_unit_price: "2", // ¥2/1M → 2000 micro/1K → 33333
            output_unit_price: "8", // ¥8/1M → 8000 → 133333
          },
        ],
      },
    );
    expect(out.target_margin_bps).toBe(7000);
    expect(out.derived[0]!.input_micro_per_1k).toBe("33333");
    expect(out.derived[0]!.output_micro_per_1k).toBe("133333");
    // 缓存维未声明回落 input
    expect(out.derived[0]!.cache_read_micro_per_1k).toBe("33333");
  });
});

describe("CreditPricingRouter applyRate", () => {
  it("事务内先关旧窗口、再插新行，回 closed_id", async () => {
    const { ro, rw, calls } = pools({ closedId: "old-id" });
    const res = await new CreditPricingRouter(ro, rw).applyRate(
      req(["pricing:credit_rate.manage"]),
      {
        provider_code: "deepseek",
        model_code: "deepseek/v4",
        input_micro_per_1k: 33333,
        output_micro_per_1k: 133333,
        cache_write_micro_per_1k: 33333,
        cache_read_micro_per_1k: 3333,
      },
    );
    expect(res.closed_id).toBe("old-id");
    expect(res.created.id).toBe(RATE.id);
    const tx = calls.filter((s) =>
      /begin|update metering|insert into metering|commit/i.test(s),
    );
    expect(/begin/i.test(tx[0]!)).toBe(true);
    expect(/update metering/i.test(tx[1]!)).toBe(true);
    expect(/insert into metering/i.test(tx[2]!)).toBe(true);
    expect(/commit/i.test(tx[3]!)).toBe(true);
  });
  it("同作用域同生效时刻 23505 → 409 + rollback", async () => {
    const { ro, rw, calls } = pools({ insertCode: "23505" });
    await expect(
      new CreditPricingRouter(ro, rw).applyRate(
        req(["pricing:credit_rate.manage"]),
        {
          provider_code: "deepseek",
          model_code: "deepseek/v4",
          input_micro_per_1k: 1,
          output_micro_per_1k: 1,
          cache_write_micro_per_1k: 1,
          cache_read_micro_per_1k: 1,
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(calls.some((s) => /rollback/i.test(s))).toBe(true);
  });
  it("负数费率 → 400", async () => {
    const { ro, rw } = pools();
    await expect(
      new CreditPricingRouter(ro, rw).applyRate(
        req(["pricing:credit_rate.manage"]),
        {
          input_micro_per_1k: -1,
          output_micro_per_1k: 1,
          cache_write_micro_per_1k: 1,
          cache_read_micro_per_1k: 1,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
