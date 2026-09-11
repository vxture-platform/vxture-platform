/**
 * product-catalog-partial-update.spec.ts —— `PUT :id` 缺席即不改（2026-09-11）。
 *
 * ── 这一条钉的是一处真的在生产上丢数据的缺陷 ──
 * `PUT :id` 的 SET 取值原先一律 `body.x ?? 默认值`。而产品详情页只送其中 11 个字段
 * ——于是每保存一次，没送的四列就被写成 `category_id = null`、
 * `standalone_subscribable = true`、`capability_keys = []`、`tags = []`。
 *
 * **它没有任何外在症状**：接口回 200，界面提示保存成功，而那几个字段本来就不在页面
 * 上，所以看不出区别。要等到某个产品在目录里归错了类，或者一个本不该单独售卖的组件
 * 突然可以单买，才会有人发现——那时已经无从判断是谁在哪一次保存里弄没的。
 *
 * ── 断言看参数，不看 SQL 文本 ──
 * 修法是 `CASE WHEN $n::bool THEN 新值 ELSE 旧值 END`，所以**每一列都恒在 SET 列表
 * 里**（这是故意的：SQL 保持静态，`lint:anchor-writes` 才读得到它）。于是「这一列这
 * 次写不写」只体现在那个布尔参数上，断言必须落在参数上。
 *
 * 返回值也不能用来判：它来自 `RETURNING`，读的是写完之后的行，看它永远是自洽的。
 */
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

import { ProductCatalogRouter } from "./product-catalog.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-00000000000a";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["platform:product.manage"],
    operatorAccessToken: "operator-access-token",
    headers: {},
  } as unknown as Request & RequestContext;
}

function makeRouter() {
  let sql = "";
  let params: unknown[] = [];
  const client = {
    query: vi.fn(async (text: string, args?: unknown[]) => {
      if (/UPDATE product\.products/.test(text)) {
        sql = text;
        params = args ?? [];
        return { rows: [{ id: PRODUCT_ID, surfaces: [] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client as unknown as PoolClient),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
  const router = new ProductCatalogRouter(
    pool,
    {
      platform: {
        ATLAS_API_URL: "http://atlas.test/",
        RUNOS_API_URL: "http://runos.test/",
      },
    } as unknown as VxConfigService,
    {
      getToken: vi.fn(async () => "obo"),
    } as unknown as OperatorExchangeService,
  );

  /**
   * 某一列这次会不会被写——从 SQL 里解析出它的 `$n::bool` 编号，再去参数里取。
   *
   * **刻意不把编号写死在测试里**：那样测试就成了 SQL 的抄本，两边一起改一起错，
   * 而「一起错」正是它该抓的东西。解析不到就抛，不给默认值。
   */
  function writes(column: string): boolean {
    const m = new RegExp(`${column}\\s*=\\s*CASE WHEN\\s+\\$(\\d+)::bool`).exec(
      sql,
    );
    if (!m?.[1])
      throw new Error(`${column} 不是 CASE 三态列，或 SQL 变了：${sql}`);
    return params[Number(m[1]) - 1] as boolean;
  }

  return { router, sql: () => sql, params: () => params, writes };
}

/**
 * 详情页真正送的那 11 个字段——照着 ProductDetailPage.tsx 的 `save()` 抄。
 *
 * `origin` 是受管枚举（`ProductOrigin`），不加 `as const` 会被推成 `string`。
 */
const DETAIL_PAGE_BODY = {
  origin: "self" as const,
  productCode: "vxtpl",
  productName: "专注训练智能体",
  productNick: "VXTPL",
  description: null,
  productType: "general_agent",
  originProvider: null,
  isCustomerVisible: true,
  isWorkforceVisible: true,
  surfaces: ["web"],
  iconUrl: null,
};

describe("PUT :id · 缺席即不改", () => {
  it("详情页那份请求不碰它没送的四列", async () => {
    const t = makeRouter();
    await t.router.update(makeReq(), PRODUCT_ID, DETAIL_PAGE_BODY);
    /* 这四列是详情页界面上根本没有的字段。原实现会把它们写成默认值。 */
    for (const col of [
      "category_id",
      "standalone_subscribable",
      "capability_keys",
      "tags",
    ]) {
      expect(t.writes(col), `${col} 这次不该被写`).toBe(false);
    }
    /* 送了的照写——否则「一列都不写」也能让上面四条过。 */
    for (const col of ["product_nick", "is_customer_visible", "icon_url"]) {
      expect(t.writes(col), `${col} 这次该写`).toBe(true);
    }
  });

  it("显式 null 是清空，不是不改——两者不能合并", async () => {
    const t = makeRouter();
    await t.router.update(makeReq(), PRODUCT_ID, {
      ...DETAIL_PAGE_BODY,
      categoryId: null,
    });
    expect(t.writes("category_id")).toBe(true);
  });

  it("有值就覆盖", async () => {
    const t = makeRouter();
    await t.router.update(makeReq(), PRODUCT_ID, {
      ...DETAIL_PAGE_BODY,
      categoryId: 7,
      tags: ["a", "b"],
    });
    expect(t.writes("category_id")).toBe(true);
    expect(t.writes("tags")).toBe(true);
    expect(t.params()).toContain(7);
  });

  it("占位符编号连续，且 WHERE 用的是最后一个", async () => {
    /* 24 个参数手写编号，错位不会报错——只会把值写到别的列上去。 */
    const t = makeRouter();
    await t.router.update(makeReq(), PRODUCT_ID, DETAIL_PAGE_BODY);
    const used = [...t.sql().matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const n = t.params().length;
    expect([...new Set(used)].sort((a, b) => a - b)).toEqual(
      Array.from({ length: n }, (_, i) => i + 1),
    );
    expect(t.sql()).toContain(`WHERE id = $${n}`);
    expect(t.params()[n - 1]).toBe(PRODUCT_ID);
  });

  it("每个 CASE 的布尔位与值位是相邻的一对", async () => {
    /* `$3::bool THEN $4` ——两两配对写错（比如 THEN $5）不会有任何报错，
       只会让这一列拿到隔壁列的值。 */
    const t = makeRouter();
    await t.router.update(makeReq(), PRODUCT_ID, DETAIL_PAGE_BODY);
    const pairs = [
      ...t.sql().matchAll(/CASE WHEN\s+\$(\d+)::bool THEN\s+\$(\d+)/g),
    ];
    expect(pairs.length).toBe(11);
    for (const [, flag, value] of pairs) {
      expect(Number(value)).toBe(Number(flag) + 1);
    }
  });
});
