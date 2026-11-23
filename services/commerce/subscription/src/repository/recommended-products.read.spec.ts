/**
 * Verify the separate Console and desktop recommendation projections.
 * @package @vxture/service-subscription
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-23
 */
import { describe, expect, it, vi } from "vitest";
import {
  readRecommendedAgentCodes,
  readRecommendedProducts,
} from "./recommended-products.read";

describe("tenant recommendation reads", () => {
  it("binds the tenant and orders both projections after excluding subscription history", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const tenant = "tenant'--";
    await readRecommendedProducts({ query }, tenant);
    await readRecommendedAgentCodes({ query }, tenant);
    expect(query.mock.calls).toHaveLength(2);
    for (const [sql, params] of query.mock.calls) {
      expect(params).toEqual([tenant]);
      expect(sql).not.toContain(tenant);
      expect(sql).toMatch(
        /not exists\s*\([\s\S]+?ts\.tenant_id = \$1 and ts\.deleted_at is null[\s\S]+?sub_pc\.product_id = prod\.id/,
      );
      expect(sql).not.toContain("ts.workspace_id");
      expect(sql).toContain("order by prod.sort asc, prod.product_code asc");
    }
  });

  it("keeps Console prices out of the desktop query and preserves valid order", async () => {
    const commercial = [{ product_code: "free-agent", min_price: "0.00" }];
    const agents = [{ productCode: "second" }, { productCode: "first" }];
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: commercial })
      .mockResolvedValueOnce({ rows: agents });
    expect(await readRecommendedProducts({ query }, "org")).toEqual(commercial);
    expect(await readRecommendedAgentCodes({ query }, "org")).toEqual(agents);
    expect(query.mock.calls[0]?.[0]).toContain("product.plan_prices");
    const desktopSql = query.mock.calls[1]?.[0];
    expect(desktopSql).not.toMatch(/plan_prices|min_price|currency/);
    expect(desktopSql).toMatch(
      /prod\.release_stage in \('stable', 'beta'\)[\s\S]+limit 6/,
    );
  });

  it("distinguishes an empty list from a failed read", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("read unavailable"));
    await expect(readRecommendedAgentCodes({ query }, "org")).resolves.toEqual(
      [],
    );
    await expect(readRecommendedAgentCodes({ query }, "org")).rejects.toThrow(
      "read unavailable",
    );
  });
});
