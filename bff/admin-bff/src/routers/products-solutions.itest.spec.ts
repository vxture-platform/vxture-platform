/**
 * products-solutions.itest.spec.ts — solutions / service-plans / releases SQL smoke
 * against a REAL platform DB (2026-08-31, TD-029 close-out).
 * @package @vxture/bff-admin
 *
 * Skipped unless PRODUCT_SOLUTIONS_SMOKE=1. Run:
 *   PRODUCT_SOLUTIONS_SMOKE=1 DATABASE_URL=postgresql://... npx vitest run products-solutions.itest
 *
 * What it proves that the mocked-pool spec cannot: the three SQL statements
 * (SOLUTION_SQL / SERVICE_PLAN_SQL / RELEASES_SQL) parse and execute on the
 * live schema, the jsonb aggregates come back in the shape the projections
 * expect, and the count CTE computes against metering.subscriptions. It
 * creates one throw-away solution, binds an existing plan family to it, reads
 * everything back through the real loaders, then deletes the solution
 * (solution_products / solution_plans cascade).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  loadProductReleases,
  loadProductServicePlanDetail,
  loadProductSolutionDetail,
  loadProductSolutions,
  loadProductCapabilities,
} from "./products.router";

const RUN = process.env.PRODUCT_SOLUTIONS_SMOKE === "1";
const DB = process.env.DATABASE_URL ?? "";
const CODE = `smoke-solution-${Date.now().toString(36)}`;

describe.skipIf(!RUN)("solutions SQL smoke (live DB)", () => {
  let pool: Pool;
  let planCodes: { free: string; pro: string } = { free: "", pro: "" };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB });
    // pick two plans of the same product family that are not bound anywhere yet
    const { rows } = await pool.query<{ plan_code: string }>(
      `SELECT p.plan_code FROM product.plans p
        WHERE p.deleted_at IS NULL
          AND p.plan_code IN ('arda-free', 'arda-pro')
          AND NOT EXISTS (SELECT 1 FROM product.solution_plans sp WHERE sp.plan_id = p.id)
        ORDER BY p.plan_code`,
    );
    const codes = rows.map((r) => r.plan_code);
    planCodes = {
      free: codes.includes("arda-free") ? "arda-free" : "",
      pro: codes.includes("arda-pro") ? "arda-pro" : "",
    };
    await pool.query(
      `INSERT INTO product.solutions
         (solution_code, solution_name, industry, scenario, tags, delivery_mode, delivery_boundaries, status)
       VALUES ($1, 'Smoke 方案', '水利', '洪涝监管', ARRAY['smoke'], '平台订阅', ARRAY['含巡检','不含设备'], 'active')`,
      [CODE],
    );
    await pool.query(
      `INSERT INTO product.solution_products (solution_id, product_id, role, sort)
       SELECT s.id, p.id, '数据沉淀', 0
         FROM product.solutions s, product.products p
        WHERE s.solution_code = $1 AND p.product_code = 'arda'`,
      [CODE],
    );
    for (const [tier, planCode] of Object.entries(planCodes)) {
      if (!planCode) continue;
      await pool.query(
        `INSERT INTO product.solution_plans (solution_id, tier, plan_id)
         SELECT s.id, $2, p.id FROM product.solutions s, product.plans p
          WHERE s.solution_code = $1 AND p.plan_code = $3`,
        [CODE, tier, planCode],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM product.solutions WHERE solution_code = $1`, [
      CODE,
    ]);
    await pool.end();
  });

  // 2026-08-31: `/api/products/capabilities` 500-ed in production with
  // `syntax error at or near "{"` — PRODUCT_SOLUTION_LINKS_SQL had a bare `{}`
  // as the ARRAY_AGG fallback. The unit specs mock the pool, so only a live
  // database can catch SQL that does not parse; this case runs the same loader
  // the router calls and reads the smoke solution back through it.
  it("capabilities catalog runs the solution-links SQL against a live DB", async () => {
    const capabilities = await loadProductCapabilities(pool);
    const arda = capabilities.find((c) => c.productCode === "arda");
    expect(arda).toBeDefined();
    expect(arda!.relatedSolutions.map((r) => r.solutionCode)).toContain(CODE);
  });

  it("lists the solution with real products, tiers and numeric counts", async () => {
    const solutions = await loadProductSolutions(pool);
    const mine = solutions.find((s) => s.solutionCode === CODE);
    expect(mine).toBeDefined();
    expect(mine!.products.map((p) => p.productCode)).toEqual(["arda"]);
    expect(mine!.products[0]!.role).toBe("数据沉淀");
    expect(typeof mine!.subscriptionCount).toBe("number");
    expect(typeof mine!.monthlyRevenue).toBe("number");
    const boundTiers = Object.entries(planCodes)
      .filter(([, code]) => code)
      .map(([tier]) => tier);
    expect(mine!.tiers.map((t) => t.tierCode)).toEqual(boundTiers);
    for (const tier of mine!.tiers) {
      expect(tier.priceLabel.length).toBeGreaterThan(0);
      expect(["free", "paid", "contract"]).toContain(tier.priceKind);
    }
  });

  it("returns the detail with delivery columns", async () => {
    const detail = await loadProductSolutionDetail(pool, CODE);
    expect(detail.deliveryMode).toBe("平台订阅");
    expect(detail.deliveryBoundaries).toEqual(["含巡检", "不含设备"]);
    expect(detail.relatedServicePlans.length).toBe(detail.tiers.length);
  });

  it("resolves a bound tier to its plan version, price, entitlements and counts", async () => {
    const tier = planCodes.pro ? "pro" : planCodes.free ? "free" : null;
    if (!tier) return;
    const plan = await loadProductServicePlanDetail(pool, CODE, tier);
    expect(plan.planCode).toBe(planCodes[tier]);
    expect(plan.entitlements.some((e) => e.productCode === "arda")).toBe(true);
    expect(plan.includedProductCount + plan.excludedProductCount).toBe(
      plan.entitlements.length,
    );
    expect(typeof plan.subscriptionCount).toBe("number");
    expect(typeof plan.monthlyRevenue).toBe("number");
    expect([
      "monthly",
      "yearly",
      "contract",
      "daily",
      "weekly",
      "perpetual",
    ]).toContain(plan.price.periodType);
  });

  it("projects published plan versions as releases", async () => {
    const releases = await loadProductReleases(pool);
    expect(Array.isArray(releases)).toBe(true);
    for (const release of releases) {
      expect(release.releaseCode).toMatch(/@v\d+$/);
      expect(release).not.toHaveProperty("productRegion");
      expect(release).not.toHaveProperty("allowedAgents");
    }
  });
});
