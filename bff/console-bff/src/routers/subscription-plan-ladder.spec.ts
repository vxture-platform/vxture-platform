import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { Request } from "express";

import { SubscriptionRouter } from "./subscription.router";
import type { RequestContext } from "../types/console.types";

/**
 * 订阅页套餐阶梯 · 邀请可见性（2026-09-22）。
 *
 * 邀请订阅上线时只做了**买得到**那一半：`createOrder` 认邀请，而阶梯查询仍然
 * 只认 `is_public = true`。后果是券发下去，客户打开订阅页什么都没有——一颗
 * 点不到的按钮比灰按钮更糟，链条在客户那一侧是断的。
 *
 * 这里守三件事，都是「返回码对不对」照不出来的：
 *   ① 阶梯真的按邀请放行（不是又退回裸 is_public 过滤）
 *   ② 判据按人算（userId / tenantId 进了参数，不是对所有人一样）
 *   ③ **看一眼不消耗券**——阶梯只 select，绝不写 promotion 表
 * 第三条是这条链上最容易犯的错：把消耗挪进可见性判断，刷一次订阅页烧掉一张券。
 */

/**
 * 只关心发出的 SQL，返回值一律空集——**除了产品那一次**：查不到产品，
 * 端点会在阶梯之前就降级返回，一条阶梯 SQL 也发不出来。
 */
function recordingPool() {
  const sqls: string[] = [];
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    sqls.push(sql);
    return sql.includes("product_code") && sql.includes("product_name")
      ? { rows: [{ product_code: "arda", product_name: "Arda" }] }
      : { rows: [] };
  });
  return { pool: { query } as unknown as Pool, query, sqls };
}

function routerWith(pool: Pool): SubscriptionRouter {
  const none = null as never;
  return new SubscriptionRouter(none, none, none, none, none, pool, none, none);
}

function req(): Request & RequestContext {
  return {
    user: { id: "u-1" },
    tenant: { id: "t-1" },
    headers: {},
  } as unknown as Request & RequestContext;
}

/** 阶梯那一条：查 product.plan_components 且带价格聚合的 select。 */
function ladderSql(sqls: string[]): string {
  const hit = sqls.find(
    (s) => s.includes("as plan_version_id") && s.includes("as prices"),
  );
  if (!hit)
    throw new Error("没找到套餐阶梯那条 SQL —— 判据先坏了，不是被测的事变了");
  return hit;
}

async function runContext() {
  const { pool, query, sqls } = recordingPool();
  await routerWith(pool)
    .getSubscribeContext(req(), { product: "arda", intent: "new" })
    .catch(() => undefined);
  return { query, sqls };
}

describe("subscribe-context · 套餐阶梯的邀请可见性", () => {
  it("非公开档凭邀请进阶梯（不是裸 is_public 过滤）", async () => {
    const sql = ladderSql((await runContext()).sqls);

    expect(sql).toContain("kind = 'invite'");
    /* 公开那一半仍在，但它现在是「或」的一支，不再是唯一条件。 */
    expect(sql).toMatch(/pl\.is_public = true[\s\S]{0,120}or exists/);
  });

  it("判据按人算：userId 与 tenantId 进了参数", async () => {
    const { query, sqls } = await runContext();
    const sql = ladderSql(sqls);
    const call = query.mock.calls.find((c) => c[0] === sql);

    expect(call?.[1]).toEqual(["arda", "u-1", "t-1"]);
  });

  it("看一眼不消耗券：阶梯只读，不写 promotion 表", async () => {
    const sql = ladderSql((await runContext()).sqls).toLowerCase();

    expect(sql).toContain("promotion.vouchers");
    expect(sql).not.toMatch(/\bupdate\s+promotion\./);
    expect(sql).not.toMatch(/\binsert\s+into\s+promotion\./);
  });
});
