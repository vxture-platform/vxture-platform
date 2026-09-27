/**
 * products-plan-order.spec.ts - 套餐列表按 @shared TIERS 阶梯排序（后台与官网一致）
 * @package  @vxture/bff-admin
 * @layer    Application
 * @category test
 * @description
 *   owner 2026-09-27：「官网订阅面板顺序正常（free/starter/pro/business/enterprise），
 *   后台混乱，应该一致。」根因：admin 的套餐列表全按 plan_code 字母序，对 `<产品>-<档位>`
 *   这种码就是 business, enterprise, free, pro, starter。
 *
 *   修法只有一种：阶梯只有 @shared `TIERS` 一份，SQL 里 `array_position($n::text[], tier)`
 *   按**绑进来的参数**排，不手抄五个字面量。所以这里钉的是两件事：
 *   ① 每条列表查询都把 `[...TIERS]` 当参数递进去（丢了参数 = 回到字母序，且 SQL 会因
 *      $n 未绑而炸——两种失败都要在这里现形，而不是在运营台上）；
 *   ② SQL 文本里排序用的是 array_position + 参数占位符，没有把五个档位抄成字面量数组。
 *
 *   顺序本身（谁在前谁在后）是数据库算的，这里的 mock 算不出来；那一半在本机 dev 库上
 *   跑真 SQL 验过（PR 正文有实测输出），守卫 check-catalog-domains 另外扫手抄阶梯。
 *
 * @author AI-Generated
 * @date 2026-09-27
 */
import { describe, it, expect, vi } from "vitest";
import { TIERS } from "@vxture-platform/shared";
import { ProductsRouter } from "./products.router";
import { MANAGE, makeReq, noDbPool } from "../testing/pool-mocks";
import type { Pool } from "pg";

/** 记录每次 query 的 (sql, params)，一律回空行。 */
function recordingPool(): {
  pool: Pool;
  calls: { sql: string; params: unknown[] }[];
} {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql: String(sql), params: params ?? [] });
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } as unknown as Pool, calls };
}

const LADDER = [...TIERS];

/** 找到排序用了某个档位列的那条查询。 */
function callOrderingOn(
  calls: { sql: string; params: unknown[] }[],
  tierExpr: string,
): { sql: string; params: unknown[] } {
  const hit = calls.find(
    (c) => c.sql.includes(`array_position($`) && c.sql.includes(tierExpr),
  );
  expect(
    hit,
    `no query orders by array_position(...${tierExpr})`,
  ).toBeDefined();
  return hit!;
}

describe("套餐列表按 @shared TIERS 阶梯排序", () => {
  it("plan-matrix：$2 绑阶梯，按 plan.tier 排，同档再按 plan_code", async () => {
    const ro = recordingPool();
    const router = new ProductsRouter(ro.pool, noDbPool().pool);
    await router.listPlanMatrix(makeReq(MANAGE), undefined);
    const c = callOrderingOn(ro.calls, "plan.tier");
    expect(c.params).toEqual([false, LADDER]);
    expect(c.sql).toMatch(
      /array_position\(\$2::text\[\], plan\.tier\) NULLS LAST, plan\.plan_code ASC/,
    );
    expect(c.sql).not.toMatch(/ARRAY\['free'/);
  });

  it("GET /plans 平铺列表：先产品、再阶梯、再 plan_code（供方案绑定与代金券下拉）", async () => {
    const ro = recordingPool();
    const router = new ProductsRouter(ro.pool, noDbPool().pool);
    await router.listPlans(makeReq(MANAGE));
    const c = callOrderingOn(ro.calls, "axis.tier");
    expect(c.params).toEqual([LADDER]);
    expect(c.sql).toMatch(
      /ORDER BY axis\.product_sort ASC NULLS LAST, axis\.product_code ASC NULLS LAST,\s+array_position\(\$1::text\[\], axis\.tier\) NULLS LAST, p\.plan_code ASC/,
    );
  });

  it("releases：主组件 tier 进 LATERAL，按阶梯排", async () => {
    const ro = recordingPool();
    const router = new ProductsRouter(ro.pool, noDbPool().pool);
    await router.listReleases(makeReq(MANAGE));
    const c = callOrderingOn(ro.calls, "prod.tier");
    expect(c.params).toEqual([LADDER]);
  });

  it("solutions：档位槽位 jsonb_agg 按 $2 阶梯排，字面量阶梯已删", async () => {
    const ro = recordingPool();
    const router = new ProductsRouter(ro.pool, noDbPool().pool);
    await router.listSolutions(makeReq(MANAGE));
    const c = callOrderingOn(ro.calls, "spl.tier");
    expect(c.params).toEqual([null, LADDER]);
    expect(c.sql).not.toMatch(/ARRAY\['free','starter'/);
  });

  it("capabilities：版本历史与方案档位名两条查询都绑阶梯", async () => {
    const ro = recordingPool();
    const router = new ProductsRouter(ro.pool, noDbPool().pool);
    await router.listCapabilities(makeReq(MANAGE));
    const versions = callOrderingOn(ro.calls, "comp.tier");
    expect(versions.params).toEqual([LADDER]);
    /* DISTINCT 下排序表达式必须进选择列：tier_rank 显式选出，ORDER BY 用它。 */
    expect(versions.sql).toMatch(/AS tier_rank/);
    expect(versions.sql).toMatch(
      /ORDER BY tier_rank NULLS LAST, pl\.plan_code ASC, pv\.version_no DESC/,
    );
    const links = callOrderingOn(ro.calls, "spl.tier");
    expect(links.params).toEqual([LADDER]);
  });

  it("阶梯参数就是 @shared 的五档，低 → 高", () => {
    expect(LADDER).toEqual([
      "free",
      "starter",
      "pro",
      "business",
      "enterprise",
    ]);
  });
});
