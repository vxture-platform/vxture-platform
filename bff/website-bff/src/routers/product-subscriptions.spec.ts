import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { Request } from "express";
import { ProductSubscriptionsRouter } from "./product-subscriptions.router";
import type { RequestContext } from "../types/auth.types";

/**
 * product-subscriptions.spec.ts —— 官网订阅态要带「进行中的订单」。
 *
 * 订阅行履约才建：一笔已申报、等运营确认的新订单，在只读 metering.subscriptions 的口径下
 * 是「未订阅」，官网定价页据此照样给「订阅」按钮（owner 2026-09-27 实测 tenderforge）。
 * 这里钉住：① 有订阅行的产品带上 pendingOrder；② 只有在途单、没有订阅行的产品也要出现；
 * ③ 没有在途单时 pendingOrder 是 null，不是缺字段。
 */
const TENANT = "11111111-1111-4111-8111-111111111111";

function makeRouter(subRows: unknown[], orderRows: unknown[]) {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: subRows })
    .mockResolvedValueOnce({ rows: orderRows });
  const router = new ProductSubscriptionsRouter({ query } as unknown as Pool);
  const req = { tenantId: TENANT } as unknown as Request & RequestContext;
  return { router, req, query };
}

const SUB_ARDA = {
  product_code: "arda",
  status: "active",
  tier: "free",
  home_url: null,
  can_upgrade: true,
  suspension_reason: null,
  suspended_since: null,
  suspension_extends_term: null,
  expected_resume_at: null,
};

const OPEN_TENDERFORGE = {
  product_code: "tenderforge",
  order_id: "c26a597c-0a06-4011-82b4-e47fb87b0ab6",
  order_no: "ORD-202609-A714C75EC8",
  status: "pending_verify",
  cycle_unit: "month",
  tier: "pro",
};

describe("GET /api/me/product-subscriptions · 进行中的订单", () => {
  it("没有在途单：pendingOrder 是 null（字段恒在）", async () => {
    const { router, req } = makeRouter([SUB_ARDA], []);
    const out = await router.getProductSubscriptions(req);
    expect(out).toHaveLength(1);
    expect(out[0]!.productCode).toBe("arda");
    expect(out[0]!.pendingOrder).toBeNull();
  });

  it("只有在途单、没有订阅行的产品也要出现：subscribed=false + pendingOrder", async () => {
    const { router, req, query } = makeRouter([SUB_ARDA], [OPEN_TENDERFORGE]);
    const out = await router.getProductSubscriptions(req);
    const tf = out.find((s) => s.productCode === "tenderforge");
    expect(tf).toBeDefined();
    expect(tf!.subscribed).toBe(false);
    expect(tf!.status).toBe("none");
    expect(tf!.pendingOrder).toEqual({
      orderId: OPEN_TENDERFORGE.order_id,
      orderNo: "ORD-202609-A714C75EC8",
      tier: "pro",
      cycleUnit: "month",
      state: "pending_verify",
    });
    /* 第二条查询只认三个在途态，且按租户默认工作区收口——与订阅那条同口径。 */
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/from billing\.orders o/);
    expect(sql).toMatch(/is_default/);
    expect(params).toEqual([
      TENANT,
      ["pending_payment", "pending_verify", "paid"],
    ]);
  });

  it("同一产品既有 free 订阅又有在途升级单：合并到同一行", async () => {
    const { router, req } = makeRouter(
      [SUB_ARDA],
      [
        {
          ...OPEN_TENDERFORGE,
          product_code: "arda",
          tier: "pro",
          status: "pending_payment",
        },
      ],
    );
    const out = await router.getProductSubscriptions(req);
    expect(out).toHaveLength(1);
    expect(out[0]!.subscribed).toBe(true);
    expect(out[0]!.tier).toBe("free");
    expect(out[0]!.pendingOrder?.state).toBe("pending_payment");
    expect(out[0]!.pendingOrder?.tier).toBe("pro");
  });

  it("未登录（无 tenantId）：不查库，返回 []", async () => {
    const { router, query } = makeRouter([], []);
    const out = await router.getProductSubscriptions(
      {} as Request & RequestContext,
    );
    expect(out).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
