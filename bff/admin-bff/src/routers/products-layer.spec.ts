/**
 * products-layer.spec.ts - 产品分层在目录读模型里的透出
 * @package  @vxture/bff-admin
 * @layer    Application
 * @category test
 * @description
 *   `GET /api/products/capabilities` 是绑定候选的数据源——套餐发布页按
 *   `layer = 'L2'` 过滤谁能被绑（`80-plan-bundled-components.md` §1b）。所以这条
 *   读模型必须把 `product.products.layer` **原样**带出来。
 *
 *   钉三件事：目录查询真的要了这一列；值原样透出不加工（`productType` 走
 *   `mapProductCapabilityType` 收敛成展示枚举，`layer` 不能跟着被收敛，否则拿不来
 *   过滤）；**没分层的产品透出 `null`，不按 `product_type` 回落**。
 *
 *   最后一条是本次裁定的核心（owner 2026-09-17）。此前层级从 `product_type` 推，
 *   而判 L1 的两个分支（`model_platform` / `capability_platform`）不在受管枚举
 *   `PRODUCT_TYPES` 里、写入面挡死——那两个分支永远走不到，结果 atlas / runos /
 *   arda / karda 四个同为 `general_platform` 的产品一律被判成 L2。写成断言之后，
 *   谁想把推断逻辑加回来都会在这里当场红。
 *
 * @author AI-Generated
 * @date 2026-09-17
 */
import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { loadProductCapabilities } from "./products.router";

// ============================================================================
// Doubles
// ============================================================================

/**
 * 只读池，**按 SQL 分派**。
 *
 * 不能用 `testing/pool-mocks` 的 `readerOf`：那个对每条查询都回同一批行，而
 * `loadProductCapabilities` 在一个 `Promise.all` 里打四条（目录 / product_metrics /
 * product_webhooks / 方案关联）——同一批产品行会被后三条当成自己的行去 map。
 *
 * @param catalogRows - 目录查询要回的行
 * @returns 假池子与它收到的全部 SQL 文本（用来断言查询要了哪些列）
 */
function catalogPool(catalogRows: unknown[]): {
  pool: Pool;
  seen: string[];
} {
  const seen: string[] = [];
  const query = vi.fn(async (sql: string) => {
    const text = String(sql);
    seen.push(text);
    const lower = text.toLowerCase();
    // 目录查询是唯一一条 select 了 product_code 的；其余三条各查自己的表。
    if (
      lower.includes("from product.products") &&
      lower.includes("p.product_code")
    ) {
      return { rows: catalogRows, rowCount: catalogRows.length };
    }
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } as unknown as Pool, seen };
}

/** 一行目录记录。字段随 `ProductCatalogRow`，只有 layer / product_type 按用例给。 */
function catalogRow(over: {
  product_code: string;
  product_type: string;
  layer: string | null;
}) {
  return {
    id: `id-${over.product_code}`,
    product_code: over.product_code,
    product_type: over.product_type,
    layer: over.layer,
    origin: "self",
    release_stage: "ga",
    marketing: null,
    product_name: over.product_code,
    description: null,
    status: "active",
    is_customer_visible: true,
    is_workforce_visible: true,
    tags: [],
    category_code: null,
    plan_count: 0,
    created_at: "2026-09-17T00:00:00.000Z",
    updated_at: "2026-09-17T00:00:00.000Z",
  };
}

// ============================================================================
// Specs
// ============================================================================

describe("产品目录读模型 —— layer 的透出", () => {
  it("目录查询把 layer 一并查出来（不查就永远是 undefined，而且不会报错）", async () => {
    const { pool, seen } = catalogPool([
      catalogRow({
        product_code: "arda",
        product_type: "general_platform",
        layer: "L2",
      }),
    ]);

    await loadProductCapabilities(pool);

    const catalogSql = seen.find((s) =>
      s.toLowerCase().includes("p.product_code"),
    );
    expect(catalogSql).toBeDefined();
    expect(catalogSql).toContain("p.layer");
  });

  it("值原样透出，不跟着 productType 一起被收敛成展示枚举", async () => {
    const { pool } = catalogPool([
      catalogRow({
        product_code: "arda",
        product_type: "general_platform",
        layer: "L2",
      }),
      catalogRow({
        product_code: "atlas",
        product_type: "general_platform",
        layer: "L1",
      }),
      catalogRow({
        product_code: "vxtpl",
        product_type: "general_agent",
        layer: "L3",
      }),
    ]);

    const records = await loadProductCapabilities(pool);

    expect(records.map((r) => [r.productCode, r.layer])).toEqual([
      ["arda", "L2"],
      ["atlas", "L1"],
      ["vxtpl", "L3"],
    ]);
  });

  it("没分层的产品透出 null —— 不按 product_type 回落成 L2", async () => {
    // 这两个产品的 product_type 全是 general_platform。旧实现从类型推层级，
    // 会把它们一律判成 L2；现在层级只认列，没填就是没填。
    const { pool } = catalogPool([
      catalogRow({
        product_code: "runos",
        product_type: "general_platform",
        layer: null,
      }),
      catalogRow({
        product_code: "umbra",
        product_type: "general_platform",
        layer: null,
      }),
    ]);

    const records = await loadProductCapabilities(pool);

    expect(records.map((r) => r.layer)).toEqual([null, null]);
    // 同一批行的 productType 仍然被正常加工——证明两条路互不干扰。
    expect(records.every((r) => typeof r.productType === "string")).toBe(true);
  });
});
