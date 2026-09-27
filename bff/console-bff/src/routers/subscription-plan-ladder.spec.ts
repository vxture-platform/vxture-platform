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

/**
 * 产品级维护窗口（owner 2026-09-27）：subscribe-context 回 `product.maintenance`，
 * SubscribePage 据此在顶部出横幅、禁用档位与周期按钮。判据只看 `product.products`
 * 两列，不读 admin schema。
 *
 * 与上面那个 recordingPool 分开：这里要控制产品那一行的内容，而不只是记 SQL。
 */
function poolWithProduct(productRow: Record<string, unknown>) {
  /* 只认产品那一条（按 where 子句）：在途订单那条 SQL 也同时提到 product_code 与
     product_name，按列名认会把产品行喂给它，然后在 created_at 上炸。 */
  const query = vi.fn(async (sql: string) =>
    sql.includes("from product.products") &&
    sql.includes("where product_code = $1")
      ? { rows: [productRow] }
      : { rows: [] },
  );
  return { pool: { query } as unknown as Pool, query };
}

describe("subscribe-context · 升级维护中", () => {
  const MAINTAINED = {
    product_code: "arda",
    product_name: "Arda",
    maintenance_window_id: "w-1",
    maintenance_until: new Date("2026-10-01T02:00:00Z"),
  };

  it("window id 非空：product.maintenance 带预计恢复时刻（ISO）", async () => {
    const { pool } = poolWithProduct(MAINTAINED);
    const ctx = await routerWith(pool).getSubscribeContext(req(), {
      product: "arda",
      intent: "new",
    });

    expect(ctx.product).toEqual({
      code: "arda",
      name: "Arda",
      maintenance: { until: "2026-10-01T02:00:00.000Z" },
    });
  });

  it("两列都空：maintenance 是 null，不是 undefined——前端按 null 判", async () => {
    const { pool } = poolWithProduct({
      ...MAINTAINED,
      maintenance_window_id: null,
      maintenance_until: null,
    });
    const ctx = await routerWith(pool).getSubscribeContext(req(), {
      product: "arda",
      intent: "new",
    });

    expect(ctx.product?.maintenance).toBeNull();
  });

  it("产品那条 SQL 真的 select 了那两列（判据不许读一个没查的列）", async () => {
    const { pool, query } = poolWithProduct(MAINTAINED);
    await routerWith(pool).getSubscribeContext(req(), {
      product: "arda",
      intent: "new",
    });

    const sql = query.mock.calls
      .map((c) => String(c[0]))
      .find((s) => s.includes("product_name") && s.includes("product_code"));
    expect(sql).toContain("maintenance_window_id");
    expect(sql).toContain("maintenance_until");
  });
});
