import { describe, expect, it, vi } from "vitest";
import {
  HELD_PRODUCT_TILES_SQL,
  HELD_SUBSCRIPTION_STATUSES,
  collapseProductTiles,
  listHeldProductTiles,
  type HeldProductRow,
} from "./product-app-tiles";

/* 磁贴推导的回归守卫。写它不是为了覆盖率：上一版 /api/me/apps 是写死目录 +
 * 一个永远不通过的门控（tenant id 当 workspace id 传），坏了也没有任何东西
 * 会报错。这里把「一产品一磁贴」「active 压过 trialing」「primary 压过 bundled」
 * 三条判据钉住，并用假池子核 SQL 的参数形状。 */

type PoolLike = Parameters<typeof listHeldProductTiles>[0];

function row(overrides: Partial<HeldProductRow> = {}): HeldProductRow {
  return {
    product_code: "arda",
    product_name: "数据平台",
    product_nick: "Arda",
    icon_url: null,
    home_url: "http://localhost:3230",
    status: "active",
    plan_name: "Arda Pro",
    tier: "pro",
    component_role: "primary",
    sort: 10,
    ...overrides,
  };
}

describe("collapseProductTiles", () => {
  it("folds several subscriptions of one product into a single tile", () => {
    const tiles = collapseProductTiles([
      row({ plan_name: "Arda Pro" }),
      row({ plan_name: "Arda Starter", tier: "starter" }),
    ]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ code: "arda", planName: "Arda Pro" });
  });

  it("lets an active subscription label the tile over a trialing one", () => {
    const tiles = collapseProductTiles([
      row({ status: "trialing", plan_name: "Trial" }),
      row({ status: "active", plan_name: "Paid" }),
    ]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ status: "active", planName: "Paid" });
  });

  it("prefers the primary component's plan over a bundled one at equal status", () => {
    const tiles = collapseProductTiles([
      row({ component_role: "bundled", plan_name: "Host bundle", tier: null }),
      row({ component_role: "primary", plan_name: "Own plan", tier: "pro" }),
    ]);
    expect(tiles[0]).toMatchObject({ planName: "Own plan", tier: "pro" });
  });

  it("orders tiles by catalog sort then code and passes nullable fields through", () => {
    const tiles = collapseProductTiles([
      row({
        product_code: "karda",
        product_name: "知识平台",
        product_nick: null,
        home_url: null,
        sort: 20,
      }),
      row({ product_code: "atlas", product_name: "模型平台", sort: 20 }),
      row({ product_code: "arda", sort: 10 }),
    ]);
    expect(tiles.map((t) => t.code)).toEqual(["arda", "atlas", "karda"]);
    expect(tiles[2]).toMatchObject({
      homeUrl: null,
      nick: null,
      iconUrl: null,
    });
  });

  it("ignores rows whose status is not a held status", () => {
    expect(collapseProductTiles([row({ status: "expired" })])).toEqual([]);
  });
});

describe("listHeldProductTiles", () => {
  it("queries the tenant's default workspace with the held-status set and collapses rows", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [row(), row({ status: "trialing" })] });
    const pool = { query } as unknown as PoolLike;

    const tiles = await listHeldProductTiles(pool, "tenant-1");

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(HELD_PRODUCT_TILES_SQL, [
      "tenant-1",
      [...HELD_SUBSCRIPTION_STATUSES],
    ]);
    expect(tiles).toEqual([
      expect.objectContaining({ code: "arda", status: "active" }),
    ]);
  });

  it("returns an empty list when the workspace holds nothing", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as PoolLike;
    await expect(listHeldProductTiles(pool, "tenant-1")).resolves.toEqual([]);
  });
});

describe("HELD_PRODUCT_TILES_SQL", () => {
  it("keeps the filters that separate 'held now' from 'ever subscribed'", () => {
    for (const clause of [
      "w.is_default",
      "w.deleted_at is null",
      "ts.deleted_at is null",
      "ts.status = any($2::text[])",
      "prod.status = 'active'",
      "prod.is_customer_visible = true",
    ]) {
      expect(HELD_PRODUCT_TILES_SQL).toContain(clause);
    }
  });
});
