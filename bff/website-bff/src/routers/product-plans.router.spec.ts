import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { ProductPlansRouter } from "./product-plans.router";

// GET /api/products/:code/plans — 公开套餐阶梯的容错契约与形状:
//   1. 正常产品 → product 元数据 + 按 TIERS 排序的阶梯(features/quota/seats/prices 透传);
//   2. 未知/不可见产品 → { product: null, plans: [] },且不再查询阶梯;
//   3. 有产品但无已发布套餐 → plans: [];
//   4. 非法产品码 → 空响应且完全不触 DB(公开端点不做 4xx)。
// 与 console-bff queryPlanLadder 的口径一致性由 SQL 文本对齐保证,此处只测行为。

const ARDA = {
  product_code: "arda",
  product_name: "Arda",
  product_nick: "Arda 数据平台",
  release_version: "1.4.0",
};

/** 依查询顺序编程的 pool:第 1 次 = 产品行,第 2 次 = 阶梯行。 */
function makePool(productRows: unknown[], ladderRows: unknown[] = []) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: productRows })
    .mockResolvedValueOnce({ rows: ladderRows });
  return { pool: { query } as unknown as Pool, query };
}

describe("ProductPlansRouter", () => {
  it("returns the tier-ordered ladder with quota highlights for a known product", async () => {
    const { pool } = makePool(
      [ARDA],
      [
        {
          plan_code: "arda-pro",
          plan_name: "Arda Pro",
          description: "Arda Pro tier for Arda.",
          tier: "pro",
          features: ["sync.realtime", "varda.enabled"],
          quota: { "member.max": 1, "storage.gb": 500 },
          prices: [
            {
              cycleUnit: "month",
              cycleCount: 1,
              price: "499.00",
              currency: "CNY",
            },
            {
              cycleUnit: "year",
              cycleCount: 1,
              price: "4999.00",
              currency: "CNY",
            },
          ],
        },
        {
          plan_code: "arda-free",
          plan_name: "Arda Free",
          description: null,
          tier: "free",
          features: [],
          quota: null,
          prices: [],
        },
      ],
    );
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");

    expect(res.product).toEqual({
      code: "arda",
      name: "Arda",
      nick: "Arda 数据平台",
      releaseVersion: "1.4.0",
    });
    // TIERS 排序:free 在 pro 前,无论 SQL 返回顺序。
    expect(res.plans.map((p) => p.tier)).toEqual(["free", "pro"]);
    const [free, pro] = res.plans;
    expect(pro?.planCode).toBe("arda-pro");
    // 档位名/描述是 product.plans 真列,原样透传(官网卡片标题/副标题不再来自 i18n)。
    expect(pro?.planName).toBe("Arda Pro");
    expect(pro?.description).toBe("Arda Pro tier for Arda.");
    expect(free?.description).toBeNull();
    expect(pro?.seats).toBe(1);
    expect(pro?.quota).toEqual({ "member.max": 1, "storage.gb": 500 });
    expect(pro?.prices).toHaveLength(2);
    expect(free?.seats).toBeNull();
  });

  it("degrades to an empty ladder for an unknown product without querying plans", async () => {
    const { pool, query } = makePool([]);
    const res = await new ProductPlansRouter(pool).getProductPlans("nope");
    expect(res).toEqual({ product: null, plans: [] });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns the product with an empty ladder when no version is published", async () => {
    const { pool } = makePool([ARDA], []);
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.product?.code).toBe("arda");
    expect(res.plans).toEqual([]);
  });

  it("rejects a malformed product code without touching the pool", async () => {
    const query = vi.fn(() => {
      throw new Error("DB must not be touched");
    });
    const router = new ProductPlansRouter({ query } as unknown as Pool);
    const res = await router.getProductPlans("Arda; drop table--");
    expect(res).toEqual({ product: null, plans: [] });
    expect(query).not.toHaveBeenCalled();
  });
});
