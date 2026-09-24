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
        released_at: new Date("2026-09-12T00:00:00.000Z"),
        status: "active",
      },
      {
        product_code: "vxtpl",
        product_name: "模板智能体",
        product_nick: null,
        product_type: "agent",
        description: null,
        release_version: null,
        released_at: null,
        status: "developing",
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
        // pg 把 timestamptz 交成 Date；对外一律 ISO 字符串
        releasedAt: "2026-09-12T00:00:00.000Z",
        status: "active",
        /* 两个计数都缺 → 一档都没有 → 不给购买入口。 */
        subscribeAccess: "none",
      },
      {
        productCode: "vxtpl",
        productName: "模板智能体",
        productNick: null,
        productType: "agent",
        description: null,
        releaseVersion: null,
        releasedAt: null,
        /* 开发中：官网要预告它，但卡片不给购买入口。 */
        status: "developing",
        subscribeAccess: "none",
      },
    ]);
  });

  /*
   * 生命周期轴只放出两值，**认不得的一律归「开发中」**。
   *
   * 方向很重要：回落到 `active` 等于把一个读不懂的状态当成「已上线」，卡片就会给
   * 一颗订阅按钮，而定价端点（product-plans.router 按 `status = 'active'` 过滤产品）
   * 会回一张空阶梯——入口承诺一件做不到的事。宁可少给一颗按钮。
   *
   * 这一条同时是那颗按钮的**唯一**判据来源：不靠「承诺等级反正也会是 preview」，
   * 那是两根轴碰巧一致，没有任何东西保证它们一致。
   */
  it.each([
    ["已上线", "active", "active"],
    ["开发中", "developing", "developing"],
    ["认不得的值", "retired", "developing"],
    ["缺这一列（部署偏斜）", undefined, "developing"],
  ] as const)("生命周期轴：%s", async (_n, raw, expected) => {
    const { pool } = makePool([
      {
        product_code: "umbra",
        product_name: "企业密码服务平台",
        product_nick: null,
        product_type: "general_platform",
        description: null,
        release_version: null,
        released_at: null,
        status: raw,
      },
    ]);
    const res = await new ProductCatalogRouter(pool).getCatalog();
    expect(res[0]?.status).toBe(expected);
  });

  /*
   * 订阅入口三态（owner 2026-09-22）。
   *
   * 卡片上那颗按钮此前只按成熟度 × 订阅态决定，不知道有没有公开可买的档——把所有档
   * 改成邀请订阅之后，卡上照样写「订阅」，点进去落到「暂未开放订阅」。
   *
   * 三面都写，**混卖那一面是重点**：公开档与邀请档并存时对匿名访客来说它就是个能买
   * 的产品，邀请档不进公开阶梯，不该把整个产品标成邀请制。只写前两面的话，一个
   * 「有邀请档就算 invite」的实现也会绿。
   */
  it.each([
    ["有公开档", 2, 0, "public"],
    ["只有邀请档", 0, 3, "invite"],
    ["一档都没有", 0, 0, "none"],
    ["公开与邀请并存 → 仍算公开", 1, 2, "public"],
  ] as const)(
    "订阅入口三态：%s",
    async (_n, publicCount, inviteCount, expected) => {
      const { pool } = makePool([
        {
          product_code: "umbra",
          product_name: "企业密码服务平台",
          product_nick: null,
          product_type: "general_platform",
          description: null,
          release_version: "1.0.0",
          released_at: null,
          public_plan_count: publicCount,
          invite_plan_count: inviteCount,
        },
      ]);
      const res = await new ProductCatalogRouter(pool).getCatalog();
      expect(res[0]?.subscribeAccess).toBe(expected);
    },
  );

  it("计数是字符串也认（pg 的 count() 交出来是 string）", async () => {
    const { pool } = makePool([
      {
        product_code: "umbra",
        product_name: "企业密码服务平台",
        product_nick: null,
        product_type: "general_platform",
        description: null,
        release_version: null,
        released_at: null,
        public_plan_count: "0",
        invite_plan_count: "2",
      },
    ]);
    const res = await new ProductCatalogRouter(pool).getCatalog();
    expect(res[0]?.subscribeAccess).toBe("invite");
  });

  it("reads only live-or-developing, customer-visible, non-deleted products in sort order", async () => {
    const { pool, query } = makePool([]);
    await new ProductCatalogRouter(pool).getCatalog();

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0]?.[0]).replace(/\s+/g, " ");
    expect(sql).toContain("from product.products");
    expect(sql).toContain("is_customer_visible = true");
    /*
     * 产品那一条的生命周期过滤，**带表别名**。
     *
     * 这里原先断言的是裸的 `status = 'active'`，而这段 SQL 里还有一句
     * `pl.status = 'active'`（数在售套餐的那个子查询）。2026-09-24 把产品侧改成
     * `p.status in ('active','developing')` 之后，这条断言**照样通过**——它匹配到的
     * 一直是套餐那一句。一条名字叫「只读 active 产品」的断言，其实从来没在看产品。
     * 带上 `p.` 前缀，它才盯着它声称在盯的东西。
     */
    expect(sql).toContain("and p.status in ('active', 'developing')");
    expect(sql).toContain("deleted_at is null");
    expect(sql).toContain("order by p.sort asc");
    /* 三态计数必须真的在查——不然 subscribeAccess 恒为 none，而那看起来像
       「这些产品都还没开卖」，不像「判据没在查」。 */
    expect(sql).toContain("public_plan_count");
    expect(sql).toContain("invite_plan_count");
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
