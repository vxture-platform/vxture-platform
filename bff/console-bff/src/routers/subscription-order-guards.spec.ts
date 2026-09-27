/**
 * subscription-order-guards.spec.ts —— 下单前的两道门（2026-09-17）。
 *
 * `POST /api/subscription/orders` 此前没有任何 spec（console-bff 的九份测试一份都不
 * 覆盖 subscription.router）——这正是下面第二条缺口能一直存在的原因。
 *
 *  1. **成熟度兜底。**「开发中不可订」原先只长在官网卡片上（判 developing 就隐掉
 *     按钮），服务端从头到尾没有一处读 `release_stage`；权威源里那个
 *     `isReleaseStageSubscribable` 写了，却没有调用者。
 *  2. **归属校验。** `productCode` 与 `planVersionId` 是请求体里各自独立送来的两个字段，
 *     之前全程没有任何一处校验它们属于同一个产品。不校的话，第 1 条当场失效（拿
 *     ga 产品的 planVersionId 配 developing 的 productCode），而且订单落库时产品与套餐就是
 *     对不上的。
 *
 * ── 假 pool 按调用序排队，不按 SQL 匹配 ──
 * `createOrder` 到这两道门之前只查一次库（`lookupPlanPrice`），紧接着就是归属+成熟度
 * 那条合并查询。**排错一位整份 spec 就测的是别的东西**，所以第一批必须喂价格行
 * （否则会先撞 `NOT_PURCHASABLE`，测到的是另一道门）。
 */
import { describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";

import { SubscriptionRouter } from "./subscription.router";
import type { RequestContext } from "../types/console.types";

const PRICE_ROW = {
  price: "100.00",
  currency: "CNY",
  plan_code: "pro",
  plan_name: "专业版",
};

/**
 * 按序回答：第一次 = lookupPlanPrice，第二次 = 归属+成熟度。
 * 后续调用一律抛——两道门拦住时不该还有第三次查库。
 *
 * **价格那一次按真库语义作答，不是无条件回一行。** 原来它写死
 * `mockResolvedValueOnce({ rows: [PRICE_ROW] })`，于是照不出这个缺陷：
 * `lookupPlanPrice` 的 SQL 里也带着 `plan.is_public = true`，而它排在邀请解锁
 * **之前**——真库里非公开套餐在这一步就返回 0 行，NOT_PURCHASABLE 400 抛出，
 * 下面那三条「非公开 + 有邀请」的用例要证的路径整条走不到，却照样全绿。
 *
 * 桩少模拟一个上游过滤，下游的门就等于没被测过。所以这里读真正发出的 SQL：
 * 带 is_public 过滤 + 这张套餐非公开 → 回 0 行，跟 Postgres 一样。
 */
function poolOf(
  soldRow: Record<string, unknown> | undefined,
  /* 非公开套餐会多打两次库：邀请消耗（UPDATE）与台账（INSERT）。`invite` 给的是
     那条 UPDATE 的 returning——空数组 = 没有可用邀请。不传 = 不该走到那一步。
     `owns` 是续订例外那一问（本租户手上有没有同一套餐的订阅）的答案；给了它，
     那一问就排在邀请消耗之前。 */
  opts?: { invite?: unknown[]; owns?: boolean },
) {
  const planIsPublic = soldRow?.plan_is_public !== false;
  const query = vi
    .fn()
    .mockImplementationOnce(async (sql: string) => ({
      rows:
        /plan\.is_public\s*=\s*true/.test(sql) && !planIsPublic
          ? []
          : [PRICE_ROW],
    }))
    .mockResolvedValueOnce({
      /* 生命周期列（2026-09-24 新门）默认「已上线」：既有用例要证的是别的门，
         桩少这一列会让它们全部撞在新门上——那时它们测的就不是自己声称的东西了。
         专测新门的用例显式传 `product_status`。 */
      rows: soldRow ? [{ product_status: "active", ...soldRow }] : [],
    });
  if (opts?.owns !== undefined) {
    query.mockResolvedValueOnce({ rows: opts.owns ? [{ one: 1 }] : [] });
  }
  if (opts?.invite !== undefined) {
    query.mockResolvedValueOnce({ rows: opts.invite });
    query.mockResolvedValueOnce({ rows: [] });
  }
  query.mockImplementation(async () => {
    throw new Error("不该走到这里：门未拦住");
  });
  return { pool: { query } as unknown as Pool, query };
}

/** 下单路径上所有发出的 SQL 里，提到 is_public 的有几条。 */
function sqlsMentioning(
  query: { mock: { calls: unknown[][] } },
  needle: string,
) {
  return query.mock.calls.filter(
    (call) => typeof call[0] === "string" && call[0].includes(needle),
  ).length;
}

/** 八个注入里只有 pool 需要真货：两道门都排在任何 service 调用之前。 */
function routerWith(pool: Pool): SubscriptionRouter {
  const none = null as never;
  return new SubscriptionRouter(none, none, none, none, none, pool, none, none);
}

function req(): Request & RequestContext {
  return {
    user: { id: "u-1" },
    tenant: { id: "t-1" },
    headers: {},
  } as unknown as Request & RequestContext;
}

/**
 * 「三道门都放行」的**肯定式**断言。
 *
 * 放行后会往下走到 `resolveDefaultWorkspace`，假 pool 在第三次调用上抛一个**不带
 * 语义码**的普通 Error——所以 `codeOf` 为 undefined 恰好证明它穿过了所有带码的门。
 *
 * 原来这两条写的是「报错不再是这两个码」。否定式断言会**静默接受新的失败**：
 * 2026-09-22 加 `is_public` 门时，用例的桩没有那一列 → 当场撞新门 → 抛的是第三个
 * 码 → 「不是那两个码」照样成立，80 条全绿，而它们要证的「继续往下走」已经不成立。
 */
function expectPassedAllGates(error: unknown): void {
  expect(codeOf(error)).toBeUndefined();
}

/** 桩收到的 SQL 里有没有碰过某张表。比数调用次数表意——次数会把放行后
    `resolveDefaultWorkspace` 那一次也算进来，改动别处就会误红。 */
function touched(query: { mock: { calls: unknown[][] } }, table: string) {
  return query.mock.calls.some(
    (call) => typeof call[0] === "string" && call[0].includes(table),
  );
}

/** 从封套里取给客户看的那句话；console 直接展示它，没有按码翻译的表。 */
function messageOf(error: unknown): string | undefined {
  const res = (error as { getResponse?: () => unknown })?.getResponse?.();
  return typeof res === "object" && res !== null
    ? (res as { message?: string }).message
    : undefined;
}

/** 从封套里取语义码；不是 HttpException 或没带码都回 undefined。 */
function codeOf(error: unknown): string | undefined {
  const res = (error as { getResponse?: () => unknown })?.getResponse?.();
  return typeof res === "object" && res !== null
    ? (res as { code?: string }).code
    : undefined;
}

const BODY = {
  productCode: "vxtpl",
  planVersionId: "pv-1",
  cycleUnit: "month",
  intent: "new",
};

describe("POST orders · 归属与成熟度两道门", () => {
  it("套餐卖的是别的产品：400 PLAN_PRODUCT_MISMATCH，不再往下走", async () => {
    const { pool, query } = poolOf({
      product_code: "karda",
      release_stage: "stable",
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: "PLAN_PRODUCT_MISMATCH",
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("套餐根本找不到 primary 组件：同样按不匹配拒（fail-closed）", async () => {
    const { pool } = poolOf(undefined);
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: "PLAN_PRODUCT_MISMATCH",
    });
  });

  /*
   * 生命周期轴那道门（2026-09-24）。
   *
   * 它此前**不存在**：下单路径从头到尾没读过 `prod.status`。两个目录都按
   * `status = 'active'` 过滤，所以界面上到不了；但判据不在界面上——拿到一个
   * planVersionId 就能给一个「信息填好了、东西还没建」的产品下单成功。
   *
   * `stable` 是这几条的关键：承诺等级那道门会放行，所以拦住它的只能是新门。若两条
   * 判据在同一根轴上，这几条用例会在旧门上绿，什么也没证明。
   */
  it.each(["developing", "draft", "inactive", "deprecated"] as const)(
    "未上线产品（status=%s，承诺等级 stable）：409 PRODUCT_NOT_LIVE",
    async (status) => {
      const { pool } = poolOf({
        product_code: "vxtpl",
        product_status: status,
        release_stage: "stable",
        plan_is_public: true,
      });
      const err = await routerWith(pool)
        .createOrder(req(), BODY)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(codeOf(err)).toBe("PRODUCT_NOT_LIVE");
    },
  );

  it("查不到 status（部署偏斜 / 列没选）也拦：宁可拦住不放过", async () => {
    const { pool } = poolOf({
      product_code: "vxtpl",
      product_status: undefined,
      release_stage: "stable",
      plan_is_public: true,
    });
    const err = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);
    expect(codeOf(err)).toBe("PRODUCT_NOT_LIVE");
  });

  it("预览版产品：409 PRODUCT_NOT_RELEASED，话说的是「预览」", async () => {
    const { pool, query } = poolOf({
      product_code: "vxtpl",
      release_stage: "preview",
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "PRODUCT_NOT_RELEASED",
    });
    expect(messageOf(error)).toContain("预览");
    expect(messageOf(error)).not.toContain("停售");
    expect(query).toHaveBeenCalledTimes(2);
  });

  /*
   * 停售（sunset，2026-09-27）：同一个码，但话必须说成「已停售」。此前一律说「尚在
   * 预览阶段」——对一个卖过的产品这句是错的，客户拿着「预览」去问运营会找错方向。
   * 码不拆（console 直接展示 message），所以两面都要写：preview 那条不能被改成
   * 「停售」，sunset 这条不能还说「预览」。
   */
  it("停售产品：同一个 409 PRODUCT_NOT_RELEASED，话说的是「已停售」", async () => {
    const { pool, query } = poolOf({
      product_code: "vxtpl",
      release_stage: "sunset",
      plan_is_public: true,
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe("PRODUCT_NOT_RELEASED");
    expect(messageOf(error)).toContain("停售");
    expect(messageOf(error)).not.toContain("预览");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("beta + 公开套餐：三道门都放行", async () => {
    const { pool } = poolOf({
      product_code: "vxtpl",
      release_stage: "beta",
      plan_is_public: true,
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expectPassedAllGates(error);
  });

  it("ga + 公开套餐：同上", async () => {
    const { pool } = poolOf({
      product_code: "vxtpl",
      release_stage: "stable",
      plan_is_public: true,
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expectPassedAllGates(error);
  });

  /*
   * 非公开套餐（2026-09-22）。
   *
   * `plans.is_public` 此前**只是列表过滤**：console-bff 在 subscribe-context 与
   * recommended-products 两处滤掉它，而下单端点从头到尾没读过这一列——「非公开」
   * 只做到了看不见，知道 planVersionId 的人照样下得了单。生产库里正有这么一个：
   * arda-beta-trial（22 个套餐里唯一的非公开，active、已发布、有价格行）。
   *
   * 两面各一条：非公开必须被拦（下），公开必须放行（上两条）。只写前者的话，
   * 一个恒拒的门也会绿。
   */
  /*
   * 邀请订阅（2026-09-22）。三面：
   *   有有效邀请 → 放行（穿过所有带码的门）
   *   无邀请     → 仍是 PLAN_NOT_PUBLIC，且**不写台账**
   *   公开套餐   → 根本不查邀请（只有 2 次查库）
   * 第三条是这组的重点：没有它，一个「对所有套餐都去查邀请」的实现也会绿，
   * 而那会给每一次正常下单平白加两次查库。
   */
  it("非公开 + 有有效邀请：放行", async () => {
    const { pool, query } = poolOf(
      { product_code: "vxtpl", release_stage: "stable", plan_is_public: false },
      { invite: [{ id: "v-1", batch_id: "b-1" }] },
    );
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expectPassedAllGates(error);
    expect(touched(query, "promotion.vouchers")).toBe(true);
    expect(touched(query, "voucher_redemptions")).toBe(true);
  });

  it("非公开 + 无可用邀请：仍然 409，且不写台账", async () => {
    const { pool, query } = poolOf(
      { product_code: "vxtpl", release_stage: "stable", plan_is_public: false },
      { invite: [] },
    );
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe("PLAN_NOT_PUBLIC");
    expect(touched(query, "promotion.vouchers")).toBe(true);
    // 消耗那条影响 0 行 → 不该再写台账。
    expect(touched(query, "voucher_redemptions")).toBe(false);
  });

  it("公开套餐：根本不查邀请", async () => {
    const { pool, query } = poolOf({
      product_code: "vxtpl",
      release_stage: "stable",
      plan_is_public: true,
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expectPassedAllGates(error);
    expect(touched(query, "promotion.vouchers")).toBe(false);
  });

  it("非公开套餐：409 PLAN_NOT_PUBLIC", async () => {
    const { pool } = poolOf(
      { product_code: "vxtpl", release_stage: "stable", plan_is_public: false },
      { invite: [] },
    );
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe("PLAN_NOT_PUBLIC");
  });

  /*
   * 续订例外（2026-09-22）。
   *
   * 邀请挡的是进门。少了这条例外，把一个在售档改成邀请制会连带掐断**老客户的
   * 续订**（409，客户什么都没做错），而且每续一次要烧一张券。
   *
   * 两面都写，反面是重点：光看 `intent === "renew"` 就放行的实现，会让任何人
   * 把 intent 写成 renew 就绕过邀请——它在正面那条用例下照样绿。
   */
  it("非公开 + 续订自己手上这一档：放行，且不动邀请券", async () => {
    const { pool, query } = poolOf(
      { product_code: "vxtpl", release_stage: "stable", plan_is_public: false },
      { owns: true },
    );
    const error = await routerWith(pool)
      .createOrder(req(), { ...BODY, intent: "renew" })
      .catch((e: unknown) => e);

    expectPassedAllGates(error);
    expect(touched(query, "promotion.vouchers")).toBe(false);
    expect(touched(query, "voucher_redemptions")).toBe(false);
  });

  it("非公开 + 声称续订但手上没有这一档：仍要邀请", async () => {
    const { pool, query } = poolOf(
      { product_code: "vxtpl", release_stage: "stable", plan_is_public: false },
      { owns: false, invite: [] },
    );
    const error = await routerWith(pool)
      .createOrder(req(), { ...BODY, intent: "renew" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe("PLAN_NOT_PUBLIC");
    expect(touched(query, "promotion.vouchers")).toBe(true);
  });

  /*
   * 判据只许长在一处（2026-09-22）。
   *
   * 上面那几条用例证的是「门的行为对不对」，这一条证的是**门只有一道**。两者不能
   * 互相替代：可见性判据一旦同时长在查价 SQL 和闸门 SQL 上，前者排在前面，邀请解锁
   * 就成了永远走不到的死分支——而每一条只看返回码的用例都照样绿。
   *
   * 所以直接查性质：下单路径上发出的 SQL 里，提到 is_public 的必须恰好一条。
   */
  it("下单路径上 is_public 只出现在闸门那一条 SQL 里", async () => {
    const { pool, query } = poolOf(
      { product_code: "vxtpl", release_stage: "stable", plan_is_public: false },
      { invite: [{ id: "v-1", batch_id: "b-1" }] },
    );
    await routerWith(pool)
      .createOrder(req(), BODY)
      .catch(() => undefined);

    /* 先钉住**第一条**（查价）：判据一旦爬回它身上，调用在那里就中止了，
       「全路径恰好一条」反而照样成立——只数总数的写法对这个缺陷是瞎的。 */
    expect(String(query.mock.calls[0]?.[0])).not.toContain("is_public");
    expect(sqlsMentioning(query, "is_public")).toBe(1);
  });
});

/*
 * 产品级维护窗口（owner 2026-09-27）。
 *
 * 升级 / 迁移期间产品「当前不可用」——未订阅的暂时不能订阅。判据只看
 * `product.products` 的两列：`maintenance_window_id` 非空 = 维护中，`maintenance_until`
 * = 预计恢复。这是**非正常**的一道，排在生命周期与承诺等级之后、套餐可见性之前。
 *
 * 五面：
 *   维护中          → 409 PRODUCT_UNDER_MAINTENANCE，话里带「升级维护中」与预计恢复时刻
 *   两列都空        → 与此前一样穿过所有带码的门（新门不许误伤正常流程）
 *   维护中 + 未上线 → 先报 PRODUCT_NOT_LIVE（正常流程的判定一条不动）
 *   维护中 + 停售   → 先报 PRODUCT_NOT_RELEASED（同上）
 *   维护中 + 非公开 → 拦在维护这道，**不去消耗邀请券**——门排在邀请之后就会白烧一张券
 * 外加一条查性质：闸门那条 SQL 真的 select 了那两列。判据读一个没查的列不报错，
 * 只是永远为 undefined、门永远不关——「存在≠在跑」。
 */
describe("POST orders · 升级维护中", () => {
  const MAINTAINED = {
    product_code: "vxtpl",
    release_stage: "stable",
    plan_is_public: true,
    maintenance_window_id: "w-1",
    /* UTC 02:00 = Asia/Shanghai 10:00 —— 时区错了这条就红。 */
    maintenance_until: new Date("2026-10-01T02:00:00Z"),
  };

  it("维护中：409 PRODUCT_UNDER_MAINTENANCE，话里带「升级维护中」与预计恢复时刻", async () => {
    const { pool, query } = poolOf(MAINTAINED);
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe("PRODUCT_UNDER_MAINTENANCE");
    expect(messageOf(error)).toContain("升级维护中");
    /* 平台时区 + 长日期长时间：与 console 其他时间同一形态。 */
    expect(messageOf(error)).toContain("2026/10/01 10:00:00");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("两列都空：与此前一样穿过所有带码的门", async () => {
    const { pool } = poolOf({
      ...MAINTAINED,
      maintenance_window_id: null,
      maintenance_until: null,
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expectPassedAllGates(error);
  });

  it("维护中但产品未上线：先报 PRODUCT_NOT_LIVE——正常流程的判定不动", async () => {
    const { pool } = poolOf({ ...MAINTAINED, product_status: "developing" });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe("PRODUCT_NOT_LIVE");
  });

  it("维护中但已停售：先报 PRODUCT_NOT_RELEASED，话说的仍是「已停售」", async () => {
    const { pool } = poolOf({ ...MAINTAINED, release_stage: "sunset" });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe("PRODUCT_NOT_RELEASED");
    expect(messageOf(error)).toContain("停售");
  });

  it("维护中 + 非公开套餐：拦在维护这道，不去消耗邀请券", async () => {
    const { pool, query } = poolOf(
      { ...MAINTAINED, plan_is_public: false },
      { invite: [{ id: "v-1", batch_id: "b-1" }] },
    );
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(codeOf(error)).toBe("PRODUCT_UNDER_MAINTENANCE");
    expect(touched(query, "promotion.vouchers")).toBe(false);
    expect(touched(query, "voucher_redemptions")).toBe(false);
  });

  it("闸门那条 SQL 真的 select 了那两列", async () => {
    const { pool, query } = poolOf(MAINTAINED);
    await routerWith(pool)
      .createOrder(req(), BODY)
      .catch(() => undefined);

    const gateSql = String(query.mock.calls[1]?.[0]);
    expect(gateSql).toContain("maintenance_window_id");
    expect(gateSql).toContain("maintenance_until");
  });
});
