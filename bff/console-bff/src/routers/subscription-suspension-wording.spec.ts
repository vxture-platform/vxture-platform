/**
 * subscription-suspension-wording.spec.ts —— 冻结中的订阅按原因分词（产品维护窗口 PR B）。
 *
 * 此前 console 只出网一个布尔（顺不顺延），原因留在运营侧——于是产品级维护把一个产品名下
 * 所有租户一起暂停时，客户看到的仍是红色「已暂停」，像是他自己出了什么事。现在四条读路径
 * （已订阅产品 / 订阅列表 / 订阅详情 current / 订单表的服务列）都带上未闭合 episode 的
 * 原因、预计恢复时刻、顺不顺延，前端按原因分词。
 *
 * 这里钉四件事：
 *   ① 四个原因**原样**出网，一个都不少——前端词表按值域穷尽，少一个就落到「已暂停」而不报错；
 *   ② 存量冻结行没有 episode：三个字段都是 null，但块本身不是 null——「在暂停、说不清原因」
 *      与「没在暂停」是两件事；
 *   ③ 没在暂停中即使桩里带了列也回 null（防桩数据，也防将来有人把 resumed_at 谓词删掉）；
 *   ④ SQL 真的只取**未闭合**的那条（resumed_at is null）——闭合的 episode 是历史，不是现状。
 *
 * 走真实读路径、拿假 pool 按 SQL 作答（与 subscription-order-axis.spec 同一做法），断言前端
 * 真正收到的形状。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { Request } from "express";
import { SUSPENSION_REASONS } from "@vxture-platform/shared";

import { SubscriptionRouter } from "./subscription.router";
import type { RequestContext } from "../types/console.types";

const NOW = new Date("2026-11-20T02:00:00.000Z");
const RESUME_AT = new Date("2026-11-21T02:00:00.000Z");
const RESUME_ISO = "2026-11-21T02:00:00.000Z";

function req(): Request & RequestContext {
  return {
    user: { id: "u-1" },
    tenant: { id: "t-1" },
    headers: {},
  } as unknown as Request & RequestContext;
}

/** pool 按 SQL 作答：每个用例只关心一条投影，其余查询一律空集。 */
function poolAnswering(
  answer: (sql: string) => Record<string, unknown>[] | null,
) {
  const query = vi.fn(async (sql: string) => ({ rows: answer(sql) ?? [] }));
  return { pool: { query } as unknown as Pool, query };
}

function routerWith(pool: Pool): SubscriptionRouter {
  const none = null as never;
  /* 收藏服务：已订阅产品那条路径会问一次；给空集，别让它走降级分支刷 warn。 */
  const favorites = { listProductIds: async () => [] } as never;
  return new SubscriptionRouter(
    none,
    none,
    none,
    none,
    none,
    pool,
    none,
    favorites,
  );
}

/** 四条路径各自的 SQL 特征；认错了会喂错行，所以按「只有这一条才有」的列名认。 */
const isWorkspaceSql = (sql: string) =>
  sql.includes("from tenancy.workspaces") && sql.includes("is_default");
const isSubscribedProductsSql = (sql: string) =>
  sql.includes("as subscription_id") && sql.includes("prod.product_nick");
const isMySubscriptionsSql = (sql: string) => sql.includes("ts.pay_amount");
const isCurrentSql = (sql: string) =>
  sql.includes("ts.trial_end_at") && sql.includes("sus.suspension_reason");
const isProductSql = (sql: string) =>
  sql.includes("from product.products") &&
  sql.includes("where product_code = $1");
const isMyOrdersSql = (sql: string) =>
  sql.includes("as ttl_anchor") && sql.includes("where o.tenant_id = $1");

/** episode 三列的桩：默认「在暂停、没有 episode」（存量冻结行）。 */
const NO_EPISODE = {
  suspension_reason: null,
  suspension_expected_resume_at: null,
  suspension_extends_term: null,
};

function subscribedProductRow(over: Record<string, unknown> = {}) {
  return {
    subscription_id: "s-1",
    product_id: "p-1",
    product_code: "arda",
    product_name: "Arda",
    product_nick: null,
    release_version: null,
    released_at: null,
    plan_name: "Starter",
    tier: "starter",
    seats: null,
    subscription_kind: "paid",
    cycle_unit: "month",
    status: "suspended",
    start_at: null,
    end_at: null,
    auto_renew: false,
    maintenance_window_id: null,
    maintenance_until: null,
    ...NO_EPISODE,
    ...over,
  };
}

async function subscribedProduct(over: Record<string, unknown>) {
  const { pool, query } = poolAnswering((sql) =>
    isWorkspaceSql(sql)
      ? [{ id: "ws-1" }]
      : isSubscribedProductsSql(sql)
        ? [subscribedProductRow(over)]
        : null,
  );
  const out = await routerWith(pool).getSubscribedProducts(req());
  return { view: out[0]!, query };
}

describe("已订阅产品：未闭合 episode 的原因 / 预计恢复 / 顺不顺延一起出网", () => {
  it.each(SUSPENSION_REASONS)(
    "原因 %s 原样出网，一个都不少",
    async (reason) => {
      const { view } = await subscribedProduct({
        suspension_reason: reason,
        suspension_expected_resume_at: RESUME_AT,
        suspension_extends_term: reason !== "customer_violation",
      });

      expect(view.status).toBe("suspended");
      expect(view.suspension).toEqual({
        reason,
        expectedResumeAt: RESUME_ISO,
        extendsTerm: reason !== "customer_violation",
      });
    },
  );

  it("存量冻结行没有 episode：三个字段都是 null，块本身不是 null", async () => {
    const { view } = await subscribedProduct({});

    expect(view.suspension).toEqual({
      reason: null,
      expectedResumeAt: null,
      extendsTerm: null,
    });
  });

  it("运营没填预计恢复时刻：expectedResumeAt 是 null，其余照常", async () => {
    const { view } = await subscribedProduct({
      suspension_reason: "dispute_review",
      suspension_extends_term: true,
    });

    expect(view.suspension).toEqual({
      reason: "dispute_review",
      expectedResumeAt: null,
      extendsTerm: true,
    });
  });

  it("没在暂停中：即使桩里带着 episode 列也回 null", async () => {
    const { view } = await subscribedProduct({
      status: "active",
      suspension_reason: "platform_ops",
      suspension_expected_resume_at: RESUME_AT,
      suspension_extends_term: true,
    });

    expect(view.suspension).toBeNull();
  });

  it("库里的生词不漏到界面：认不得的原因值当作没有", async () => {
    const { view } = await subscribedProduct({
      suspension_reason: "not_a_reason",
      suspension_extends_term: true,
    });

    expect(view.suspension?.reason).toBeNull();
    expect(view.suspension?.extendsTerm).toBe(true);
  });

  it("SQL 只取未闭合的那条 episode（resumed_at is null），且不写 metering", async () => {
    const { query } = await subscribedProduct({});
    const sql = query.mock.calls
      .map((c) => String(c[0]))
      .find(isSubscribedProductsSql)!
      .toLowerCase();

    expect(sql).toContain("metering.subscription_suspensions");
    expect(sql).toMatch(/resumed_at\s+is\s+null/);
    expect(sql).not.toMatch(
      /\b(update|insert\s+into|delete\s+from)\s+metering\./,
    );
  });
});

describe("订阅列表（/my）：同一份判据", () => {
  it("暂停中的行带原因；顺不顺延照库里的值，不按原因另推一遍", async () => {
    const { pool } = poolAnswering((sql) =>
      isMySubscriptionsSql(sql)
        ? [
            {
              id: "s-1",
              tenant_id: "t-1",
              plan_id: "pl-1",
              plan_name: "Starter",
              status: "suspended",
              pay_amount: "0.00",
              currency: "CNY",
              cycle_unit: "month",
              end_at: null,
              auto_renew: false,
              subscription_kind: "paid",
              suspension_reason: "customer_violation",
              suspension_expected_resume_at: null,
              suspension_extends_term: false,
            },
          ]
        : null,
    );
    const out = await routerWith(pool).getMySubscriptions(req());

    expect(out[0]!.suspension).toEqual({
      reason: "customer_violation",
      expectedResumeAt: null,
      extendsTerm: false,
    });
  });

  it("在用的行：suspension 是 null，不是 undefined——前端按 null 判", async () => {
    const { pool } = poolAnswering((sql) =>
      isMySubscriptionsSql(sql)
        ? [
            {
              id: "s-1",
              tenant_id: "t-1",
              plan_id: "pl-1",
              plan_name: "Starter",
              status: "active",
              pay_amount: "0.00",
              currency: "CNY",
              cycle_unit: "month",
              end_at: null,
              auto_renew: true,
              subscription_kind: "paid",
              ...NO_EPISODE,
            },
          ]
        : null,
    );
    const out = await routerWith(pool).getMySubscriptions(req());

    expect(out[0]!.suspension).toBeNull();
  });
});

describe("订阅详情（subscribe-context.current）：同一份判据", () => {
  it("维护窗口的 episode：platform_ops + 预计恢复 + 顺延", async () => {
    const { pool } = poolAnswering((sql) =>
      isProductSql(sql)
        ? [
            {
              product_code: "arda",
              product_name: "Arda",
              maintenance_window_id: "w-1",
              maintenance_until: RESUME_AT,
            },
          ]
        : isCurrentSql(sql)
          ? [
              {
                id: "s-1",
                status: "suspended",
                plan_version_id: "pv-1",
                end_at: null,
                trial_end_at: null,
                suspension_reason: "platform_ops",
                suspension_expected_resume_at: RESUME_AT,
                suspension_extends_term: true,
                auto_renew: false,
                tier: "starter",
                plan_code: "arda-starter",
              },
            ]
          : null,
    );
    const ctx = await routerWith(pool).getSubscribeContext(req(), {
      product: "arda",
      intent: "new",
    });

    expect(ctx.current?.status).toBe("suspended");
    expect(ctx.current?.suspension).toEqual({
      reason: "platform_ops",
      expectedResumeAt: RESUME_ISO,
      extendsTerm: true,
    });
  });
});

describe("订单表的服务列：暂停中的订阅带原因，未履约的单什么都不带", () => {
  function orderRow(over: Record<string, unknown> = {}) {
    return {
      order_id: "o-1",
      order_no: "OD20261120001",
      workspace_id: "ws-1",
      subscription_id: "s-1",
      subscription_status: "suspended",
      order_status: "fulfilled",
      payment_ttl_minutes: 30,
      invoice_id: "inv-1",
      bill_no: "BL20261120001",
      plan_code: "starter",
      plan_name: "Starter",
      tier: "starter",
      cycle_unit: "month",
      payable_amount: "10.00",
      currency: "CNY",
      bill_status: "paid",
      total_amount: "10.00",
      paid_amount: "10.00",
      discount_amount: "0",
      voucher_paid: "0",
      ttl_anchor: NOW,
      refund_in_flight: false,
      refunded_amount: "0",
      paid_at: NOW,
      created_at: NOW,
      start_at: NOW,
      end_at: null,
      tenant_name: "T",
      owner_user_id: "u-1",
      workspace_name: "WS",
      workspace_no: "3000000001",
      product_code: "arda",
      product_name: "Arda",
      created_by_type: "customer",
      created_by_id: "u-1",
      subscriber_name: "U",
      declared_at: NOW,
      ...NO_EPISODE,
      ...over,
    };
  }

  async function firstOrder(over: Record<string, unknown>) {
    const { pool } = poolAnswering((sql) =>
      isMyOrdersSql(sql) ? [orderRow(over)] : null,
    );
    const out = await routerWith(pool).getMyOrders(req());
    return out[0]!;
  }

  it("已履约且订阅暂停中：subscriptionSuspension 带原因", async () => {
    const o = await firstOrder({
      suspension_reason: "dispute_review",
      suspension_extends_term: true,
    });

    expect(o.subscriptionStatus).toBe("suspended");
    expect(o.subscriptionSuspension).toEqual({
      reason: "dispute_review",
      expectedResumeAt: null,
      extendsTerm: true,
    });
  });

  it("未履约（没有订阅）：subscriptionSuspension 是 null", async () => {
    const o = await firstOrder({
      subscription_id: null,
      subscription_status: null,
      order_status: "pending_payment",
      invoice_id: null,
      bill_status: null,
      paid_amount: null,
      paid_at: null,
      start_at: null,
    });

    expect(o.subscriptionStatus).toBeNull();
    expect(o.subscriptionSuspension).toBeNull();
  });
});
