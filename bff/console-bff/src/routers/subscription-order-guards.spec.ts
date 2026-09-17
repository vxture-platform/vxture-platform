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

  it("beta 可订：两道门都放行（报错不再是这两个码）", async () => {
    const { pool } = poolOf({ product_code: "vxtpl", release_stage: "beta" });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    /* 放行后会往下走到 resolveDefaultWorkspace，假 pool 在那里抛——这正是
       「两道门没拦」的证据。

       **断言落在语义码上，不落在异常类上**：`resolveDefaultWorkspace` 自己就抛
       `BadRequestException`（「租户缺少默认工作空间」），拿异常类当判据会跟它撞车。
       要钉的是「报错不再是这两道门的码」，与前三条同一口径。 */
    expect(codeOf(error)).not.toBe("PRODUCT_NOT_RELEASED");
    expect(codeOf(error)).not.toBe("PLAN_PRODUCT_MISMATCH");
  });

  it("ga 可订：同上", async () => {
    const { pool } = poolOf({ product_code: "vxtpl", release_stage: "ga" });
    const error = await routerWith(pool)
      .createOrder(req(), BODY)
      .catch((e: unknown) => e);

    expect(codeOf(error)).not.toBe("PRODUCT_NOT_RELEASED");
    expect(codeOf(error)).not.toBe("PLAN_PRODUCT_MISMATCH");
  });
});
