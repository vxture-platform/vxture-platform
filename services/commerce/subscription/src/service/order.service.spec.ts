import { describe, expect, it, vi } from "vitest";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { OrderService } from "./order.service";
import type { OrderRecord } from "../types/order.types";
import type { ProrationBasis } from "../repository/pg-order.repository";

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
    getProrationBasis: vi.fn(
      async (_id: string): Promise<ProrationBasis> => ({
        paidAmount: 100,
        startAt: new Date(Date.now() - 15 * 86_400_000),
        endAt: new Date(Date.now() + 15 * 86_400_000),
        consumableShare: null,
        usageRemainingRatio: 0.8,
      }),
    ),
    grantLeftoverToPrepaid: vi.fn(async () => true),
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

describe("OrderService upgrade proration (P2-a)", () => {
  it("createOrder(upgrade) attaches the quote: credit = P_old × ((1−α)r + αu), payable = P_new − credit", async () => {
    const { service, orders } = build(
      order({ intent: "upgrade", fromSubscriptionId: "sub-1" }),
      sub({ planVersionId: PV_FREE, status: "active" }),
    );
    await service.createOrder({
      tenantId: "t-1",
      workspaceId: WS,
      planVersionId: PV_PRO,
      cycleUnit: "month",
      price: 300,
      createdBy: "u-1",
      intent: "upgrade",
      fromSubscriptionId: "sub-1",
      itemName: "Pro",
    });
    const input = (
      orders.createOrder as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]![0] as {
      proration: { credit: number; payable: number; leftover: number };
    };
    // 30-day cycle, ~15 days left (r≈0.5), u=0.8, α default 0.5 → 100×(0.25+0.4)=65
    // 剩余天数向下取整：夹在 14/30（63.33）与 15/30（65）之间，不依赖用例执行时刻
    expect(input.proration.credit).toBeGreaterThanOrEqual(63.33);
    expect(input.proration.credit).toBeLessThanOrEqual(65);
    expect(input.proration.payable).toBeCloseTo(
      300 - input.proration.credit,
      2,
    );
    expect(input.proration.leftover).toBe(0);
  });

  it("quoteUpgrade: a subscription with no consumable pools credits by time only", async () => {
    const { service, orders } = build(order(), sub());
    orders.getProrationBasis.mockResolvedValueOnce({
      paidAmount: 120,
      startAt: new Date(Date.now() - 292 * 86_400_000),
      endAt: new Date(Date.now() + 73 * 86_400_000),
      consumableShare: null,
      usageRemainingRatio: null,
    });
    const q = await service.quoteUpgrade("sub-1", 240);
    expect(q.alpha).toBe(0);
    expect(q.credit).toBeCloseTo(24, 0);
  });

  it("fulfill(upgrade) grants the leftover to the prepaid balance after the plan switch", async () => {
    const { service, orders } = build(
      order({
        intent: "upgrade",
        fromSubscriptionId: "sub-1",
        payableAmount: "0.00",
        creditAmount: "150.00",
        leftoverAmount: "50.00",
      }),
      sub({ planVersionId: PV_FREE, status: "active" }),
    );
    await service.fulfill("ord-1", { actorType: "operator", actorId: "op" });
    expect(orders.grantLeftoverToPrepaid).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ord-1" }),
      expect.objectContaining({ actorType: "operator" }),
    );
  });

  it("fulfill(upgrade) with no leftover never touches the prepaid balance", async () => {
    const { service, orders } = build(
      order({ intent: "upgrade", fromSubscriptionId: "sub-1" }),
      sub({ planVersionId: PV_FREE, status: "active" }),
    );
    await service.fulfill("ord-1", { actorType: "operator", actorId: "op" });
    expect(orders.grantLeftoverToPrepaid).not.toHaveBeenCalled();
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

describe("OrderService.runAutoRenewalPass (P2-c)", () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    subscriptionId: "sub-1",
    tenantId: "t-1",
    workspaceId: WS,
    productId: "prod-1",
    planVersionId: PV_PRO,
    cycleUnit: "month",
    cycleCount: 1,
    endAt: new Date(Date.now() + 2 * 86_400_000),
    status: "active",
    kind: "paid",
    createdById: "u-1",
    currency: "CNY",
    planName: "Pro",
    price: "100.00",
    ...over,
  });

  function buildRenewal(cands: Record<string, unknown>[]) {
    const base = build(
      order({ intent: "renew", fromSubscriptionId: "sub-1" }),
      sub({ planVersionId: PV_PRO, endAt: new Date() }),
    );
    const orders = base.orders as typeof base.orders & {
      findAutoRenewCandidates: ReturnType<typeof vi.fn>;
      withOrderTx: ReturnType<typeof vi.fn>;
      settleZeroOrderTx: ReturnType<typeof vi.fn>;
    };
    orders.findAutoRenewCandidates = vi.fn(async () => cands);
    orders.withOrderTx = vi.fn(
      async (_id: string, fn: (ctx: unknown) => Promise<unknown>) =>
        fn({
          client: {},
          order: order({ status: "pending_payment" }),
          invoice: null,
        }),
    );
    orders.settleZeroOrderTx = vi.fn(async () => undefined);
    orders.getById.mockImplementation(async () =>
      order({ intent: "renew", fromSubscriptionId: "sub-1", status: "paid" }),
    );
    return { ...base, orders };
  }

  it("paid plan: creates a system renew order with a grace TTL and leaves it pending", async () => {
    const { service, orders, subscriptions } = buildRenewal([candidate()]);
    const out = await service.runAutoRenewalPass({ leadDays: 7, graceDays: 3 });
    expect(out).toEqual({ created: 1, fulfilled: 0, skipped: 0 });
    expect(orders.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: "renew",
        fromSubscriptionId: "sub-1",
        createdBy: null,
        createdByType: "system",
        price: 100,
      }),
    );
    const input = (
      orders.createOrder as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]![0] as { paymentTtlMinutes: number };
    // end in 2 days + 3 days grace ≈ 5 days, well above the 60-minute floor
    expect(input.paymentTtlMinutes).toBeGreaterThan(4 * 24 * 60);
    expect(orders.settleZeroOrderTx).not.toHaveBeenCalled();
    expect(subscriptions.updateSubscription).not.toHaveBeenCalled();
  });

  it("free plan: settles the ¥0 order in-tx and fulfils immediately (end date extended)", async () => {
    const { service, orders, subscriptions } = buildRenewal([
      candidate({ kind: "free", price: "0.00" }),
    ]);
    const out = await service.runAutoRenewalPass({ leadDays: 7, graceDays: 3 });
    expect(out).toEqual({ created: 1, fulfilled: 1, skipped: 0 });
    expect(orders.settleZeroOrderTx).toHaveBeenCalledTimes(1);
    expect(subscriptions.updateSubscription).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ endAt: expect.any(Date) }),
    );
    expect(orders.applySubscriptionTerms).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ mode: "renew" }),
    );
  });

  it("no price row for the cycle: skipped with a log, no order", async () => {
    const { service, orders } = buildRenewal([candidate({ price: null })]);
    const out = await service.runAutoRenewalPass({ leadDays: 7, graceDays: 3 });
    expect(out).toEqual({ created: 0, fulfilled: 0, skipped: 1 });
    expect(orders.createOrder).not.toHaveBeenCalled();
  });

  it("one failing candidate does not stop the pass", async () => {
    const { service, orders } = buildRenewal([
      candidate({ subscriptionId: "bad" }),
      candidate(),
    ]);
    orders.createOrder.mockRejectedValueOnce(new ConflictException("dup"));
    const out = await service.runAutoRenewalPass({ leadDays: 7, graceDays: 3 });
    expect(out.created).toBe(1);
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
