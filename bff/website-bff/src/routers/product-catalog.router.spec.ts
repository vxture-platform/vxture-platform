import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { ProductCatalogRouter } from "./product-catalog.router";

// GET /api/products/catalog — 官网公开目录的读取口径与形状：
//   1. 只读 product.products，过滤固定为 active + is_customer_visible + 未软删，按 sort 排；
//   2. 回传全是目录真列（码/主名/副名/类型/描述/发布号），目录里没填的原样回 null，
//      不在 BFF 里补默认值——营销兜底是官网 i18n 的事；
//   3. 目录里没有公开产品 → 空数组，不抛、不造行。
// 官网三处消费面（/products、/appcenter、/products/[slug]）都以此为准，所以这里
// 一旦"补"了什么，官网就会展示目录里不存在的东西。

function makePool(rows: unknown[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as unknown as Pool, query };
}

describe("ProductCatalogRouter", () => {
  it("maps catalog rows to the public shape, real columns only", async () => {
    const { pool } = makePool([
      {
        product_code: "arda",
        product_name: "数据平台",
        product_nick: "Arda",
        product_type: "data_platform",
        description: "Enterprise data platform.",
        release_version: "1.4.0",
      },
      {
        product_code: "vxtpl",
        product_name: "模板智能体",
        product_nick: null,
        product_type: "agent",
        description: null,
        release_version: null,
      },
    ]);

    const res = await new ProductCatalogRouter(pool).getCatalog();

    expect(res).toEqual([
      {
        productCode: "arda",
        productName: "数据平台",
        productNick: "Arda",
        productType: "data_platform",
        description: "Enterprise data platform.",
        releaseVersion: "1.4.0",
      },
      {
        productCode: "vxtpl",
        productName: "模板智能体",
        productNick: null,
        productType: "agent",
        description: null,
        releaseVersion: null,
      },
    ]);
  });

  it("reads only active, customer-visible, non-deleted products in sort order", async () => {
    const { pool, query } = makePool([]);
    await new ProductCatalogRouter(pool).getCatalog();

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0]).replace(/\s+/g, " ");
    expect(sql).toContain("from product.products");
    expect(sql).toContain("is_customer_visible = true");
    expect(sql).toContain("status = 'active'");
    expect(sql).toContain("deleted_at is null");
    expect(sql).toContain("order by sort asc");
    // 不接受调用方参数：公开端点没有任何按码点名的入口。
    expect(query.mock.calls[0]?.length).toBe(1);
  });

  it("returns an empty list when the catalog has no public products", async () => {
    const { pool } = makePool([]);
    await expect(new ProductCatalogRouter(pool).getCatalog()).resolves.toEqual(
      [],
    );
  });
});
