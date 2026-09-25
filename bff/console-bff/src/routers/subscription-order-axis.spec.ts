/**
 * subscription-order-axis.spec.ts —— 订单轴十态派生（2026-09-25）。
 *
 * 为什么是这一层：`deriveOrderState` 是模块私有函数，没有导出。要么为了测试把它导出
 * （给生产代码开一个只有测试用的口子），要么走真实读路径。这里走真路径——`GET
 * /api/subscription/orders` 拿假 pool 喂行，断言前端真正收到的 `orderStatus`。
 *
 * 被这份 spec 钉住的那个缺陷：六态里 `refunded` 与 `cancelled` 落在同一支，于是一张
 * **退过款**的单在界面上写着「已取消 · 未付款」——而它付过钱。这是代码里唯一一句关于
 * 钱的假话（2026-09-25 owner 定稿的状态机文档 §差距 一之一）。
 */
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { Request } from "express";

import { SubscriptionRouter } from "./subscription.router";
import type { RequestContext } from "../types/console.types";

const NOW = new Date("2026-09-25T02:00:00.000Z");
/** 详情端点的 `loadOrderRow` 先按 UUID_RE 过一遍再查库，所以这里必须是真 UUID。 */
const ORDER_UUID = "33333333-3333-4333-8333-333333333333";

/** 一张走完全程的付费单；每个用例只改它关心的那几个字段。 */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "o-1",
    order_no: "OD20260925001",
    workspace_id: "ws-1",
    subscription_id: "sub-1",
    subscription_status: "active",
    order_status: "fulfilled",
    payment_ttl_minutes: 30,
    invoice_id: "inv-1",
    bill_no: "BL20260925001",
    plan_code: "starter",
    plan_name: "入门版",
    tier: "starter",
    cycle_unit: "year",
    payable_amount: "100.00",
    currency: "CNY",
    bill_status: "paid",
    total_amount: "100.00",
    paid_amount: "100.00",
    discount_amount: "0",
    voucher_paid: "0",
    ttl_anchor: NOW,
    refund_in_flight: false,
    refunded_amount: "0",
    paid_at: NOW,
    created_at: NOW,
    start_at: NOW,
    end_at: new Date("2027-09-25T02:00:00.000Z"),
    tenant_name: "如音工作室",
    owner_user_id: "u-1",
    workspace_name: "默认工作区",
    workspace_no: "3000000001",
    product_code: "vxtpl",
    product_name: "样板智能体",
    created_by_type: "customer",
    created_by_id: "u-1",
    subscriber_name: "张三",
    declared_at: NOW,
    ...over,
  };
}

function routerWith(rows: Record<string, unknown>[]): SubscriptionRouter {
  const pool = {
    query: async () => ({ rows }),
  } as unknown as Pool;
  const none = undefined as never;
  return new SubscriptionRouter(none, none, none, none, none, pool, none, none);
}

/**
 * 详情端点用的 router：pool 按调用序作答（第一次订单行，其余空），退款单由假 service 给。
 * 券服务在已履约的单上不会被调到（`PAYABLE_STATES` 不含 completed 族）。
 */
function detailRouterWith(
  orderRow: Record<string, unknown>,
  refund: Record<string, unknown> | null,
): SubscriptionRouter {
  let call = 0;
  const pool = {
    query: async () => (call++ === 0 ? { rows: [orderRow] } : { rows: [] }),
  } as unknown as Pool;
  const orderService = {
    getRefundForOrder: async () => refund,
  } as unknown as never;
  const none = undefined as never;
  return new SubscriptionRouter(
    none,
    orderService,
    none,
    none,
    none,
    pool,
    none,
    none,
  );
}

function refundRow(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "rfd-1",
    refundNo: "RFD20260925001",
    orderId: "o-1",
    amount: "100.00",
    currency: "CNY",
    reason: null,
    auditStatus: "approved",
    auditRemark: null,
    refundStatus: "pending",
    requestedAt: NOW,
    auditedAt: NOW,
    refundedAt: null,
    ...over,
  };
}

function req(): Request & RequestContext {
  return {
    user: { id: "u-1" },
    tenant: { id: "t-1" },
    headers: {},
  } as unknown as Request & RequestContext;
}

async function stateOf(over: Record<string, unknown> = {}): Promise<string> {
  const orders = await routerWith([row(over)]).getMyOrders(req());
  return orders[0]!.orderStatus;
}

describe("订单轴：实体状态 → wire 十态", () => {
  it.each([
    ["pending_payment", "pending_payment"],
    ["pending_verify", "paid_pending_verify"],
    ["paid", "activating"],
    ["fulfilled", "completed"],
    ["cancelled", "cancelled"],
    ["expired", "expired"],
    ["refunded", "refunded"],
  ])("%s → %s", async (entity, wire) => {
    expect(await stateOf({ order_status: entity })).toBe(wire);
  });

  it("认不出的实体状态回落待付款（不假装已完成）", async () => {
    expect(await stateOf({ order_status: "something_new" })).toBe(
      "pending_payment",
    );
  });
});

describe("退款过的单不是取消掉的单", () => {
  it("已退款不再显示成 cancelled —— 那会连带把付费轴说成「未付款」", async () => {
    expect(await stateOf({ order_status: "refunded" })).not.toBe("cancelled");
  });

  it("退款不抹掉开通时刻：退过款的单仍然开通过", async () => {
    const orders = await routerWith([
      row({ order_status: "refunded" }),
    ]).getMyOrders(req());
    expect(orders[0]!.activatedAt).toBe(NOW.toISOString());
  });

  it("退款中的单同样保留开通时刻", async () => {
    const orders = await routerWith([
      row({ refund_in_flight: true }),
    ]).getMyOrders(req());
    expect(orders[0]!.orderStatus).toBe("refunding");
    expect(orders[0]!.activatedAt).toBe(NOW.toISOString());
  });
});

describe("部分到账：钱在账单上，订单实体不动", () => {
  it("未付 + 账单 partial → 部分到账", async () => {
    expect(
      await stateOf({
        order_status: "pending_payment",
        bill_status: "partial",
      }),
    ).toBe("partially_paid");
  });

  it("待核 + 账单 partial 仍是「待核对」——客户没法二次申报，别给他一个必定 409 的按钮", async () => {
    expect(
      await stateOf({ order_status: "pending_verify", bill_status: "partial" }),
    ).toBe("paid_pending_verify");
  });

  it("已履约的单不看账单 partial（那是历史残留，服务已经给出去了）", async () => {
    expect(
      await stateOf({ order_status: "fulfilled", bill_status: "partial" }),
    ).toBe("completed");
  });
});

describe("退款在途与部分退款", () => {
  it("在审 / 在执行 → 退款中", async () => {
    expect(await stateOf({ refund_in_flight: true })).toBe("refunding");
  });

  it("退成功且退回的比收进来的少 → 部分退款", async () => {
    expect(
      await stateOf({ paid_amount: "100.00", refunded_amount: "40.00" }),
    ).toBe("partially_refunded");
  });

  it("在途压过已部分退：又在申请第二笔时显示退款中，不把正在走的流程藏掉", async () => {
    expect(
      await stateOf({
        refund_in_flight: true,
        paid_amount: "100.00",
        refunded_amount: "40.00",
      }),
    ).toBe("refunding");
  });

  it("没退过钱不算部分退款", async () => {
    expect(await stateOf({ refunded_amount: "0" })).toBe("completed");
  });

  it("0 元单不会因为「退了 0 元」被算成部分退款", async () => {
    expect(
      await stateOf({
        payable_amount: "0.00",
        paid_amount: "0",
        refunded_amount: "0",
      }),
    ).toBe("completed");
  });
});

describe("退款展示：打款失败不能说成「已通过，等待打款」", () => {
  it("failed → stage failed", async () => {
    const router = detailRouterWith(
      row(),
      refundRow({ refundStatus: "failed" }),
    );
    const detail = await router.getOrderDetail(req(), ORDER_UUID);
    expect(detail.refund?.stage).toBe("failed");
  });

  it("failed 的单 audit 仍是 approved —— 判定顺序反了就会显示成 approved", async () => {
    const router = detailRouterWith(
      row(),
      refundRow({ refundStatus: "failed", auditStatus: "approved" }),
    );
    const detail = await router.getOrderDetail(req(), ORDER_UUID);
    expect(detail.refund?.stage).not.toBe("approved");
  });

  it("审过未执行仍是 approved（别把门修成墙）", async () => {
    const router = detailRouterWith(row(), refundRow());
    const detail = await router.getOrderDetail(req(), ORDER_UUID);
    expect(detail.refund?.stage).toBe("approved");
  });

  it("退成功仍是 refunded", async () => {
    const router = detailRouterWith(
      row(),
      refundRow({ refundStatus: "success", refundedAt: NOW }),
    );
    const detail = await router.getOrderDetail(req(), ORDER_UUID);
    expect(detail.refund?.stage).toBe("refunded");
  });
});
