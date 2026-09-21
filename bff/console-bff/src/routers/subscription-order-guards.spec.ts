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
 */
function poolOf(soldRow: Record<string, unknown> | undefined) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [PRICE_ROW] })
    .mockResolvedValueOnce({ rows: soldRow ? [soldRow] : [] })
    .mockImplementation(async () => {
      throw new Error("不该走到这里：门未拦住");
    });
  return { pool: { query } as unknown as Pool, query };
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
      release_stage: "ga",
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

  it("开发中产品：409 PRODUCT_NOT_RELEASED", async () => {
    const { pool, query } = poolOf({
      product_code: "vxtpl",
      release_stage: "developing",
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: "PRODUCT_NOT_RELEASED",
    });
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
      release_stage: "ga",
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
  it("非公开套餐：409 PLAN_NOT_PUBLIC", async () => {
    const { pool, query } = poolOf({
      product_code: "vxtpl",
      release_stage: "ga",
      plan_is_public: false,
    });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(codeOf(error)).toBe("PLAN_NOT_PUBLIC");
    // 拦住了就不该再查第三次库。
    expect(query).toHaveBeenCalledTimes(2);
  });
});
