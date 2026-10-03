/**
 * search.router.spec.ts — 全局搜索按能力逐源剪裁（2026-10-04 租户源改判细码）。
 *
 * 租户源此前判遗留扁平码 platform.tenant.manage：它和 /api/tenants 的门当时都是粗码，
 * 自己跟自己一致；2026-10-03 租户页改判 tenant:profile.read 之后，只有读码的人能开租户页、
 * 却搜不到租户。这里钉的是两条源各自认自己那一页的码，且缺码是「少一类」不是 403。
 */
import { describe, expect, it, vi } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import type { Pool } from "pg";
import type { Request } from "express";
import { SearchRouter } from "./search.router";
import type { RequestContext } from "../types/console.types";

function makeReq(capabilities: string[] | null): Request & RequestContext {
  return {
    user: capabilities ? { id: "op-1" } : undefined,
    capabilities: capabilities ?? undefined,
  } as unknown as Request & RequestContext;
}

function poolSpy() {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { pool: { query } as unknown as Pool, query };
}

/** 两条 SQL 各有一个只属于它的列：租户的 `t.name`、订单的 `cur.order_no`。 */
const issued = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls.map(([sql]) => {
    const text = String(sql);
    if (/\bt\.name\b/.test(text)) return "tenant";
    if (/\bcur\.order_no\b/.test(text)) return "order";
    throw new Error(`unknown search SQL: ${text.slice(0, 80)}`);
  });

describe("GET /api/search 按能力剪源", () => {
  it("无会话 → 401", async () => {
    const { pool } = poolSpy();
    await expect(
      new SearchRouter(pool).search(makeReq(null), "acme"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("tenant:profile.read → 只发租户查询", async () => {
    const { pool, query } = poolSpy();
    const res = await new SearchRouter(pool).search(
      makeReq(["tenant:profile.read"]),
      "acme",
    );
    expect(issued(query)).toEqual(["tenant"]);
    expect(res.skipped).toBe(false);
  });

  it("tenant:profile.manage 同样开租户源（manage 蕴含 read）", async () => {
    const { pool, query } = poolSpy();
    await new SearchRouter(pool).search(
      makeReq(["tenant:profile.manage"]),
      "acme",
    );
    expect(issued(query)).toEqual(["tenant"]);
  });

  it("commerce:order.read → 只发订单查询", async () => {
    const { pool, query } = poolSpy();
    await new SearchRouter(pool).search(
      makeReq(["commerce:order.read"]),
      "acme",
    );
    expect(issued(query)).toEqual(["order"]);
  });

  it("两码齐 → 两源并发", async () => {
    const { pool, query } = poolSpy();
    await new SearchRouter(pool).search(
      makeReq(["tenant:profile.read", "commerce:order.read"]),
      "acme",
    );
    expect(issued(query).sort()).toEqual(["order", "tenant"]);
  });

  it("一个源的码都没有 → 不 403，空结果、一条查询都不发", async () => {
    const { pool, query } = poolSpy();
    const res = await new SearchRouter(pool).search(
      makeReq(["support:ticket.read"]),
      "acme",
    );
    expect(query).not.toHaveBeenCalled();
    expect(res).toEqual({ query: "acme", items: [], skipped: false });
  });
});
