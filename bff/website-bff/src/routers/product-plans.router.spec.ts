import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { ProductPlansRouter } from "./product-plans.router";

// GET /api/products/:code/plans — 公开套餐阶梯的容错契约与形状:
//   1. 正常产品 → product 元数据 + 按 TIERS 排序的阶梯(features/quota/seats/prices 透传);
//   2. 未知/不可见产品 → { product: null, plans: [] },且不再查询阶梯;
//   3. 有产品但无已发布套餐 → plans: [];
//   4. 非法产品码 → 空响应且完全不触 DB(公开端点不做 4xx);
//   5. 承诺等级 preview / sunset → subscribeAccess 恒 none、releaseStage 外露、阶梯照回;
//   6. 邀请档(is_public = false)进阶梯、每档带 access,subscribeAccess 由阶梯归纳,
//      不再另问一次邀请计数(owner 2026-09-28)。
// 与 console-bff queryPlanLadder 的口径一致性由 SQL 文本对齐保证,此处只测行为。

const ARDA = {
  product_code: "arda",
  product_name: "Arda",
  product_nick: "Arda 数据平台",
  release_version: "1.4.0",
  release_stage: "stable",
};

/** 一条能卖的公开档（阶梯非空 → 没有承诺等级那道门时该是 public）。 */
const PRO_ROW = {
  plan_code: "arda-pro",
  plan_name: "Arda Pro",
  description: null,
  tier: "pro",
  is_public: true,
  features: [],
  quota: null,
  prices: [],
};

/** 一条邀请档（is_public = false）：进阶梯，access = invite。 */
const INVITE_BUSINESS_ROW = {
  plan_code: "arda-business",
  plan_name: "Arda Business",
  description: null,
  tier: "business",
  is_public: false,
  features: [],
  quota: null,
  prices: [],
};

/**
 * 依查询顺序编程的 pool：第 1 次 = 产品行，第 2 次 = 阶梯行。**只有两问**——
 * 邀请档就在阶梯里，subscribeAccess 由它归纳；第三问（旧的邀请计数）若还发生，
 * 会拿到 undefined 而不是 rows，调用处就会炸，这里就靠这一点抓「多问了一次」。
 */
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
          is_public: true,
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
          is_public: true,
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
      releaseStage: "stable",
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
    /* 公开档 → access public；两档都公开 → 入口 public。 */
    expect(res.plans.map((p) => p.access)).toEqual(["public", "public"]);
    expect(res.subscribeAccess).toBe("public");
  });

  it("degrades to an empty ladder for an unknown product without querying plans", async () => {
    const { pool, query } = makePool([]);
    const res = await new ProductPlansRouter(pool).getProductPlans("nope");
    expect(res).toEqual({
      product: null,
      plans: [],
      subscribeAccess: "none",
      maintenance: null,
    });
    /* 产品都不存在就不该再问阶梯，也不该问邀请档。 */
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("returns the product with an empty ladder when no version is published", async () => {
    const { pool } = makePool([ARDA], []);
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.product?.code).toBe("arda");
    expect(res.plans).toEqual([]);
  });

  /*
   * 邀请档进阶梯（owner 2026-09-28）。
   *
   * 邀请订阅是**套餐级**的：admin 按档设 is_public，运营给账号定向发券。此前本端点把
   * `is_public = true` 写死在阶梯 SQL 里，再另问一次计数只为了在「全是邀请档」时给一个
   * 空态——一个产品只要全是邀请档，定价页就一档也看不见（owner：「闸门卡的太死了」）。
   *
   * 现在阶梯照回、每档带 access，subscribeAccess 由阶梯归纳。四面都写，**「只问两次」
   * 那一面是重点**：makePool 只编了两问，第三问若还发生会拿到 undefined 而炸掉。
   */
  it("只有邀请档 → 阶梯照回、每档 access invite、入口 invite，只问两次库", async () => {
    const { pool, query } = makePool([ARDA], [INVITE_BUSINESS_ROW]);
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.plans.map((p) => [p.tier, p.access])).toEqual([
      ["business", "invite"],
    ]);
    expect(res.subscribeAccess).toBe("invite");
    /* 产品行 + 阶梯 = 2 次；旧的邀请计数那一问不再发生。 */
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("公开档与邀请档并存 → 两种 access 都在阶梯里、入口 public，仍按 TIERS 排", async () => {
    const { pool, query } = makePool([ARDA], [INVITE_BUSINESS_ROW, PRO_ROW]);
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.plans.map((p) => [p.tier, p.access])).toEqual([
      ["pro", "public"],
      ["business", "invite"],
    ]);
    expect(res.subscribeAccess).toBe("public");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("只有公开档 → 与此前完全一样：access public、入口 public", async () => {
    const { pool, query } = makePool([ARDA], [PRO_ROW]);
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.plans.map((p) => p.access)).toEqual(["public"]);
    expect(res.subscribeAccess).toBe("public");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("阶梯为空 → none（一档都没有，不是「只有邀请档」）", async () => {
    const { pool } = makePool([ARDA], []);
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.plans).toEqual([]);
    expect(res.subscribeAccess).toBe("none");
  });

  it("is_public 不是明确的 true（缺列 / null）→ 按邀请档处理（保守）", async () => {
    const { pool } = makePool(
      [ARDA],
      [
        { ...PRO_ROW, is_public: null },
        { ...INVITE_BUSINESS_ROW, is_public: undefined },
      ],
    );
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.plans.map((p) => p.access)).toEqual(["invite", "invite"]);
    expect(res.subscribeAccess).toBe("invite");
  });

  it("阶梯那一问真的不再按 is_public 过滤，且把它选了出来", async () => {
    const { pool, query } = makePool([ARDA], [PRO_ROW]);
    await new ProductPlansRouter(pool).getProductPlans("arda");
    const sql = String(query.mock.calls[1]?.[0]).replace(/\s+/g, " ");
    expect(sql).not.toContain("is_public = true");
    expect(sql).not.toContain("is_public = false");
    expect(sql).toContain("pl.is_public");
    /* 产品码只许绑定参数进 SQL。 */
    expect(query.mock.calls[1]?.[1]).toEqual(["arda"]);
  });

  /*
   * 承诺等级那道门（2026-09-27）。
   *
   * 此前本端点从头到尾没读 release_stage：目录卡把停售产品指到 /pricing，落地页照样
   * 给「订阅」，再往下 console 下单撞 409。三面各一条：sunset / preview 判 none 且阶梯
   * 照回（停售的要留给老客户参考，画不画由页面决定），beta 与 stable 一样放行。
   */
  it("sunset → subscribeAccess none、releaseStage 外露、阶梯照回", async () => {
    const { pool, query } = makePool(
      [{ ...ARDA, release_stage: "sunset" }],
      [PRO_ROW],
    );
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.product?.releaseStage).toBe("sunset");
    expect(res.plans.map((p) => p.tier)).toEqual(["pro"]);
    expect(res.subscribeAccess).toBe("none");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("sunset 且只剩邀请档 → 仍是 none（邀请档也不接新进），阶梯照回", async () => {
    const { pool, query } = makePool(
      [{ ...ARDA, release_stage: "sunset" }],
      [INVITE_BUSINESS_ROW],
    );
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.subscribeAccess).toBe("none");
    expect(res.plans.map((p) => p.access)).toEqual(["invite"]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("preview → 同样 none + releaseStage 外露", async () => {
    const { pool } = makePool(
      [{ ...ARDA, release_stage: "preview" }],
      [PRO_ROW],
    );
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.product?.releaseStage).toBe("preview");
    expect(res.plans).toHaveLength(1);
    expect(res.subscribeAccess).toBe("none");
  });

  it.each(["beta", "stable"])(
    "%s + 公开档 → public（承诺等级那道门不误伤在售档）",
    async (stage) => {
      const { pool } = makePool([{ ...ARDA, release_stage: stage }], [PRO_ROW]);
      const res = await new ProductPlansRouter(pool).getProductPlans("arda");
      expect(res.product?.releaseStage).toBe(stage);
      expect(res.subscribeAccess).toBe("public");
    },
  );

  it("未登记的承诺等级按不可订处理（保守）", async () => {
    const { pool } = makePool([{ ...ARDA, release_stage: "ga" }], [PRO_ROW]);
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.subscribeAccess).toBe("none");
  });

  it("rejects a malformed product code without touching the pool", async () => {
    const query = vi.fn(() => {
      throw new Error("DB must not be touched");
    });
    const router = new ProductPlansRouter({ query } as unknown as Pool);
    const res = await router.getProductPlans("Arda; drop table--");
    expect(res).toEqual({
      product: null,
      plans: [],
      subscribeAccess: "none",
      maintenance: null,
    });
    expect(query).not.toHaveBeenCalled();
  });

  /*
   * 产品级升级维护窗口（owner 2026-09-27）。与目录端点同一真源（product.products 两列）：
   * 挂着窗口 → maintenance.until（ISO）；没挂 → null。**不动 subscribeAccess**——维护是
   * 临时运行态，正常流程里的判定照算，定价页自己按优先级把每张卡的 CTA 换成状态字。
   */
  it("挂着维护窗口 → maintenance.until 是 ISO，且 subscribeAccess 照旧", async () => {
    const { pool } = makePool(
      [
        {
          ...ARDA,
          maintenance_window_id: "6b1f1e9a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
          maintenance_until: new Date("2026-10-01T02:00:00.000Z"),
        },
      ],
      [PRO_ROW],
    );
    const res = await new ProductPlansRouter(pool).getProductPlans("arda");
    expect(res.maintenance).toEqual({ until: "2026-10-01T02:00:00.000Z" });
    expect(res.subscribeAccess).toBe("public");
    expect(res.plans).toHaveLength(1);
    /* 窗口 id 不出网。 */
    expect(JSON.stringify(res)).not.toContain("6b1f1e9a");
  });

  it("没挂维护窗口 → maintenance null（两列为空 / 缺列都算）", async () => {
    for (const row of [
      { ...ARDA, maintenance_window_id: null, maintenance_until: null },
      ARDA,
    ]) {
      const { pool } = makePool([row], [PRO_ROW]);
      const res = await new ProductPlansRouter(pool).getProductPlans("arda");
      expect(res.maintenance).toBeNull();
    }
  });

  it("产品那一问真的在选维护两列", async () => {
    const { pool, query } = makePool([ARDA], [PRO_ROW]);
    await new ProductPlansRouter(pool).getProductPlans("arda");
    const sql = String(query.mock.calls[0]?.[0]).replace(/\s+/g, " ");
    expect(sql).toContain("maintenance_window_id");
    expect(sql).toContain("maintenance_until");
    /* 产品码只许绑定参数进 SQL。 */
    expect(query.mock.calls[0]?.[1]).toEqual(["arda"]);
  });
});
