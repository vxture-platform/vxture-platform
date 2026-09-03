import { describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { OrderService } from "./order.service";
import type { OrderRecord } from "../types/order.types";

// product_330 P1-b2 — order orchestration over the order entity. The repo and
// SubscriptionService are mocked: what is asserted is the dispatch/guard logic
// (intent → which subscription primitive, which terms mode, which fallbacks).

const WS = "ws-1";
const PV_FREE = "pv-free";
const PV_PRO = "pv-pro";

function order(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "ord-1",
    orderNo: "ORD-202609-AAAAAAAAAA",
    tenantId: "t-1",
    workspaceId: WS,
    productId: "prod-1",
    planVersionId: PV_PRO,
    intent: "new",
    cycleUnit: "month",
    cycleCount: 1,
    fromSubscriptionId: null,
    subscriptionId: null,
    listAmount: "100.00",
    creditAmount: "0.00",
    payableAmount: "100.00",
    leftoverAmount: "0.00",
    currency: "CNY",
    proration: null,
    status: "paid",
    paymentTtlMinutes: 30,
    declaredAt: null,
    paidAt: new Date(),
    fulfilledAt: null,
    closedAt: null,
    closeReason: null,
    createdByType: "customer",
    createdById: "u-1",
    operatorRemark: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function sub(over: Record<string, unknown> = {}) {
  return {
    id: "sub-1",
    tenantId: "t-1",
    workspaceId: WS,
    planVersionId: PV_FREE,
    status: "active",
    endAt: null,
    ...over,
  };
}

function build(orderRow: OrderRecord, fromSub: Record<string, unknown> | null) {
  const orders = {
    getById: vi.fn(async () => orderRow),
    createOrder: vi.fn(async () => ({
      order: orderRow,
      invoiceId: "inv-1",
      billNo: "INV-1",
    })),
    findOpenOrderForProduct: vi.fn(async () => null),
    applySubscriptionTerms: vi.fn(async () => undefined),
    markFulfilled: vi.fn(async () => true),
    cancelOrder: vi.fn(async () => ({ ...orderRow, status: "cancelled" })),
    restoreOrder: vi.fn(async () => orderRow),
    findExpiredIds: vi.fn(
      async (_ttl: number, _limit: number): Promise<string[]> => [],
    ),
    findHungPaidIds: vi.fn(
      async (_age: number, _limit: number): Promise<string[]> => [],
    ),
  };
  const subscriptions = {
    getSubscription: vi.fn(async (id: string) => {
      if (fromSub && id === fromSub.id) return fromSub;
      if (id === "sub-new")
        return sub({ id: "sub-new", planVersionId: PV_PRO });
      throw new NotFoundException(`订阅 ${id} 不存在`);
    }),
    assertTierAvailable: vi.fn(
      async (_ws: string, _pv: string): Promise<void> => undefined,
    ),
    createSubscription: vi.fn(async (_input: Record<string, unknown>) =>
      sub({ id: "sub-new", planVersionId: PV_PRO }),
    ),
    upgradeSubscription: vi.fn(
      async (_id: string, _pv: string, _actor?: string, _remark?: string) =>
        sub({ planVersionId: PV_PRO }),
    ),
    updateSubscription: vi.fn(
      async (_id: string, _input: Record<string, unknown>) => sub(),
    ),
  };
  const service = new OrderService(
    orders as never,
    {} as never,
    subscriptions as never,
    {} as never,
  );
  return { service, orders, subscriptions };
}

describe("OrderService.createOrder guards", () => {
  it("new: checks tier availability, never needs a source subscription", async () => {
    const { service, orders, subscriptions } = build(
      order({ status: "pending_payment" }),
      null,
    );
    await service.createOrder({
      tenantId: "t-1",
      workspaceId: WS,
      planVersionId: PV_PRO,
      cycleUnit: "month",
      price: 100,
      createdBy: "u-1",
      intent: "new",
      itemName: "Pro",
    });
    expect(subscriptions.assertTierAvailable).toHaveBeenCalledWith(WS, PV_PRO);
    expect(orders.createOrder).toHaveBeenCalledTimes(1);
  });

  it("upgrade: 409 when the target version equals the current one", async () => {
    const { service } = build(order(), sub({ planVersionId: PV_PRO }));
    await expect(
      service.createOrder({
        tenantId: "t-1",
        workspaceId: WS,
        planVersionId: PV_PRO,
        cycleUnit: "month",
        price: 100,
        createdBy: "u-1",
        intent: "upgrade",
        fromSubscriptionId: "sub-1",
        itemName: "Pro",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("upgrade: 409 when the source subscription is not live", async () => {
    const { service } = build(order(), sub({ status: "expired" }));
    await expect(
      service.createOrder({
        tenantId: "t-1",
        workspaceId: WS,
        planVersionId: PV_PRO,
        cycleUnit: "month",
        price: 100,
        createdBy: "u-1",
        intent: "upgrade",
        fromSubscriptionId: "sub-1",
        itemName: "Pro",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("renew: 409 on a plan mismatch (renew is same-plan; switching tiers is an upgrade)", async () => {
    const { service } = build(order(), sub({ planVersionId: PV_FREE }));
    await expect(
      service.createOrder({
        tenantId: "t-1",
        workspaceId: WS,
        planVersionId: PV_PRO,
        cycleUnit: "month",
        price: 100,
        createdBy: "u-1",
        intent: "renew",
        fromSubscriptionId: "sub-1",
        itemName: "Pro",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("renew: an expired same-plan subscription is renewable (revival path)", async () => {
    const { service, orders } = build(
      order({ intent: "renew" }),
      sub({ planVersionId: PV_PRO, status: "expired" }),
    );
    await service.createOrder({
      tenantId: "t-1",
      workspaceId: WS,
      planVersionId: PV_PRO,
      cycleUnit: "month",
      price: 100,
      createdBy: "u-1",
      intent: "renew",
      fromSubscriptionId: "sub-1",
      itemName: "Pro",
    });
    expect(orders.createOrder).toHaveBeenCalledTimes(1);
  });
});

describe("OrderService.fulfill", () => {
  it("refuses an order that has not been paid", async () => {
    const { service, subscriptions } = build(
      order({ status: "pending_verify" }),
      null,
    );
    await expect(
      service.fulfill("ord-1", { actorType: "operator", actorId: "op" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(subscriptions.createSubscription).not.toHaveBeenCalled();
  });

  it("is idempotent: a fulfilled order returns its subscription without writes", async () => {
    const { service, orders, subscriptions } = build(
      order({ status: "fulfilled", subscriptionId: "sub-new" }),
      null,
    );
    const out = await service.fulfill("ord-1", {
      actorType: "system",
      actorId: null,
    });
    expect(out.subscription.id).toBe("sub-new");
    expect(orders.markFulfilled).not.toHaveBeenCalled();
    expect(subscriptions.createSubscription).not.toHaveBeenCalled();
  });

  it("new: creates an active subscription for the cycle, applies terms, flips fulfilled", async () => {
    const { service, orders, subscriptions } = build(order(), null);
    await service.fulfill("ord-1", { actorType: "operator", actorId: "op" });
    expect(subscriptions.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        planVersionId: PV_PRO,
        status: "active",
        subscriptionKind: "paid",
        activationMethod: "offline_purchase",
        orderNo: "ORD-202609-AAAAAAAAAA",
        payAmount: 100,
      }),
    );
    const input = subscriptions.createSubscription.mock
      .calls[0]![0] as unknown as {
      startAt: Date;
      endAt: Date;
    };
    expect(input.endAt.getTime()).toBeGreaterThan(input.startAt.getTime());
    expect(orders.applySubscriptionTerms).toHaveBeenCalledWith(
      "sub-new",
      expect.objectContaining({ mode: "new", orderId: "ord-1" }),
    );
    expect(orders.markFulfilled).toHaveBeenCalledWith(
      "ord-1",
      "sub-new",
      expect.objectContaining({ actorType: "operator" }),
    );
  });

  it("new: a ¥0 order creates a free-kind subscription", async () => {
    const { service, subscriptions } = build(
      order({ payableAmount: "0.00", listAmount: "0.00" }),
      null,
    );
    await service.fulfill("ord-1", { actorType: "customer", actorId: "u-1" });
    expect(subscriptions.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionKind: "free", payAmount: 0 }),
    );
  });

  it("upgrade on a live source: switches the plan version and re-anchors terms on THAT subscription", async () => {
    const { service, orders, subscriptions } = build(
      order({ intent: "upgrade", fromSubscriptionId: "sub-1" }),
      sub({ planVersionId: PV_FREE, status: "active" }),
    );
    await service.fulfill("ord-1", { actorType: "operator", actorId: "op" });
    expect(subscriptions.upgradeSubscription).toHaveBeenCalledWith(
      "sub-1",
      PV_PRO,
      "op",
      expect.any(String),
    );
    expect(subscriptions.createSubscription).not.toHaveBeenCalled();
    expect(orders.applySubscriptionTerms).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ mode: "upgrade", payAmount: "100.00" }),
    );
    expect(orders.markFulfilled).toHaveBeenCalledWith(
      "ord-1",
      "sub-1",
      expect.anything(),
    );
  });

  it("upgrade whose source died meanwhile degrades to a fresh subscription", async () => {
    const { service, subscriptions } = build(
      order({ intent: "upgrade", fromSubscriptionId: "sub-1" }),
      sub({ status: "cancelled" }),
    );
    await service.fulfill("ord-1", { actorType: "system", actorId: null });
    expect(subscriptions.upgradeSubscription).not.toHaveBeenCalled();
    expect(subscriptions.createSubscription).toHaveBeenCalledTimes(1);
  });

  it("renew on an active source extends from its current end, no status change", async () => {
    const end = new Date(Date.now() + 10 * 86_400_000);
    const { service, orders, subscriptions } = build(
      order({ intent: "renew", fromSubscriptionId: "sub-1" }),
      sub({ planVersionId: PV_PRO, status: "active", endAt: end }),
    );
    await service.fulfill("ord-1", { actorType: "operator", actorId: "op" });
    const [id, input] = subscriptions.updateSubscription.mock
      .calls[0]! as unknown as [string, { status?: string; endAt: Date }];
    expect(id).toBe("sub-1");
    expect(input.status).toBeUndefined();
    expect(input.endAt.getTime()).toBeGreaterThan(end.getTime());
    expect(orders.applySubscriptionTerms).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ mode: "renew" }),
    );
  });

  it("renew on an expired source revives it (status active) from now", async () => {
    const past = new Date(Date.now() - 5 * 86_400_000);
    const { service, subscriptions } = build(
      order({ intent: "renew", fromSubscriptionId: "sub-1" }),
      sub({ planVersionId: PV_PRO, status: "expired", endAt: past }),
    );
    await service.fulfill("ord-1", { actorType: "system", actorId: null });
    const input = subscriptions.updateSubscription.mock
      .calls[0]![1] as unknown as {
      status?: string;
      endAt: Date;
    };
    expect(input.status).toBe("active");
    expect(input.endAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("OrderService sweeps", () => {
  it("sweepExpired closes each candidate as expired by the system actor", async () => {
    const { service, orders } = build(
      order({ status: "pending_payment" }),
      null,
    );
    orders.findExpiredIds.mockResolvedValueOnce(["a", "b"]);
    const n = await service.sweepExpired(30);
    expect(n).toBe(2);
    expect(orders.cancelOrder).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ actorType: "system", actorId: null }),
      "expired",
    );
  });

  it("reconcileHungPaid stops auto-retrying an order after 3 failures", async () => {
    const { service, orders, subscriptions } = build(order(), null);
    orders.findHungPaidIds.mockResolvedValue(["ord-1"]);
    subscriptions.createSubscription.mockRejectedValue(new Error("boom"));
    for (let i = 0; i < 4; i += 1) {
      expect(await service.reconcileHungPaid(2)).toBe(0);
    }
    expect(subscriptions.createSubscription).toHaveBeenCalledTimes(3);
  });
});
