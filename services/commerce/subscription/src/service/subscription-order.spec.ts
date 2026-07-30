import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionService } from "./subscription.service";
import type { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import type { ProvisioningService } from "@vxture/service-provisioning";
import type { SubscriptionRecord } from "../types/subscription.types";

// Offline order primitives unit tests (product_320 §2): repo + provisioning
// are mocked; the subject is createOfflineOrder/activatePendingOrder/
// applyUpgradeOrder/cancelPendingOrder's guard + hook-firing behavior.

const ORDER: SubscriptionRecord = {
  id: "order-1",
  tenantId: "org-1",
  workspaceId: "ws-1",
  planVersionId: "pv-2",
  cycleType: "month",
  cycleCount: 1,
  startAt: new Date(),
  endAt: null,
  trialEndAt: null,
  status: "suspended",
  subscriptionKind: "paid",
  activationMethod: "offline_purchase",
  autoRenew: false,
  orderNo: "ORD-202607-ABCDEF0123",
  payAmount: "499",
  currency: "CNY",
  createdBy: "u-1",
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const ACTIVE_ORDER: SubscriptionRecord = { ...ORDER, status: "active" };

const LIVE_SUB: SubscriptionRecord = {
  ...ORDER,
  id: "sub-old",
  planVersionId: "pv-1",
  status: "active",
  activationMethod: "online_purchase",
};

const ARDA = {
  productId: "prod-arda",
  productCode: "arda",
  planCode: "arda-pro",
};

interface Mocks {
  repo: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    listVersionProducts: ReturnType<typeof vi.fn>;
    hasOtherActiveCoverage: ReturnType<typeof vi.fn>;
    findTierConflicts: ReturnType<typeof vi.fn>;
    createOfflineOrder: ReturnType<typeof vi.fn>;
    activateOrder: ReturnType<typeof vi.fn>;
    cancelOfflineOrder: ReturnType<typeof vi.fn>;
    restoreOfflineOrder: ReturnType<typeof vi.fn>;
  };
  provisioning: {
    onSubscriptionActivated: ReturnType<typeof vi.fn>;
    onSubscriptionDeactivated: ReturnType<typeof vi.fn>;
    enqueueEvent: ReturnType<typeof vi.fn>;
  };
  service: SubscriptionService;
}

const build = (): Mocks => {
  const repo = {
    create: vi.fn(),
    update: vi.fn(),
    getById: vi.fn(),
    listVersionProducts: vi.fn().mockResolvedValue([ARDA]),
    hasOtherActiveCoverage: vi.fn().mockResolvedValue(false),
    findTierConflicts: vi.fn().mockResolvedValue([]),
    createOfflineOrder: vi.fn(),
    activateOrder: vi.fn(),
    cancelOfflineOrder: vi.fn(),
    restoreOfflineOrder: vi.fn(),
  };
  const provisioning = {
    onSubscriptionActivated: vi
      .fn()
      .mockResolvedValue({ deliveryId: "d", seq: 1 }),
    onSubscriptionDeactivated: vi
      .fn()
      .mockResolvedValue({ deliveryId: "d", seq: 2 }),
    enqueueEvent: vi.fn().mockResolvedValue("d-evt"),
  };
  const service = new SubscriptionService(
    repo as unknown as PgSubscriptionRepository,
    provisioning as unknown as ProvisioningService,
    // Voucher-less suite: promotion is out of scope here (declare specs own it).
    { reserveForOrder: async () => [] } as never,
  );
  return { repo, provisioning, service };
};

describe("createOfflineOrder", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("checks the tier conflict for a 'new' order and creates it", async () => {
    m.repo.createOfflineOrder.mockResolvedValue({
      subscription: ORDER,
      invoiceId: "inv-1",
      billNo: "INV-202607-X",
      orderNo: ORDER.orderNo,
    });
    const result = await m.service.createOfflineOrder({
      tenantId: "org-1",
      workspaceId: "ws-1",
      planVersionId: "pv-2",
      cycleUnit: "month",
      price: 499,
      createdBy: "u-1",
      intent: "new",
      itemName: "Arda Pro",
    });
    expect(m.repo.findTierConflicts).toHaveBeenCalledWith(
      "ws-1",
      "pv-2",
      undefined,
    );
    expect(result.orderNo).toBe(ORDER.orderNo);
    // pending order still busts the C2 cache (matches createSubscription's own pattern)
    expect(m.provisioning.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
  });

  it("rejects a duplicate-tier 'new' order alongside a live subscription", async () => {
    m.repo.findTierConflicts.mockResolvedValue([
      { productCode: "arda", newTier: "pro", existingTier: "starter" },
    ]);
    await expect(
      m.service.createOfflineOrder({
        tenantId: "org-1",
        workspaceId: "ws-1",
        planVersionId: "pv-2",
        cycleUnit: "month",
        price: 499,
        createdBy: "u-1",
        intent: "new",
        itemName: "Arda Pro",
      }),
    ).rejects.toThrow(/档位不同/);
    expect(m.repo.createOfflineOrder).not.toHaveBeenCalled();
  });

  it("skips the tier-conflict guard for intent='upgrade' (a live different-tier sub is expected)", async () => {
    m.repo.createOfflineOrder.mockResolvedValue({
      subscription: ORDER,
      invoiceId: "inv-1",
      billNo: "INV-202607-X",
      orderNo: ORDER.orderNo,
    });
    await m.service.createOfflineOrder({
      tenantId: "org-1",
      workspaceId: "ws-1",
      planVersionId: "pv-2",
      cycleUnit: "month",
      price: 499,
      createdBy: "u-1",
      intent: "upgrade",
      upgradeOfSubscriptionId: "sub-old",
      itemName: "Arda Pro",
    });
    expect(m.repo.findTierConflicts).not.toHaveBeenCalled();
    expect(m.repo.createOfflineOrder).toHaveBeenCalled();
  });
});

describe("activatePendingOrder", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("activates a pending offline order and fires provisioning once", async () => {
    m.repo.getById.mockResolvedValue(ORDER);
    m.repo.activateOrder.mockResolvedValue(ACTIVE_ORDER);
    const result = await m.service.activatePendingOrder("order-1", {
      operatorId: "op-1",
    });
    expect(m.repo.findTierConflicts).toHaveBeenCalledWith(
      "ws-1",
      "pv-2",
      "order-1",
    );
    expect(m.provisioning.onSubscriptionActivated).toHaveBeenCalledTimes(1);
    expect(result?.status).toBe("active");
  });

  it("rejects activating a non-suspended / non-offline row", async () => {
    m.repo.getById.mockResolvedValue({ ...ORDER, status: "active" });
    await expect(
      m.service.activatePendingOrder("order-1", { operatorId: "op-1" }),
    ).rejects.toThrow(/待支付状态/);
    expect(m.repo.activateOrder).not.toHaveBeenCalled();
  });

  it("rejects activating a customer-paused live subscription (offline_purchase guard)", async () => {
    m.repo.getById.mockResolvedValue({
      ...ORDER,
      status: "suspended",
      activationMethod: "online_purchase",
    });
    await expect(
      m.service.activatePendingOrder("order-1", { operatorId: "op-1" }),
    ).rejects.toThrow(/待支付状态/);
  });

  it("returns null when the CAS loses (re-drive of an already-activated order)", async () => {
    m.repo.getById.mockResolvedValue(ORDER);
    m.repo.activateOrder.mockResolvedValue(null);
    const result = await m.service.activatePendingOrder("order-1", {
      operatorId: "op-1",
    });
    expect(result).toBeNull();
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
  });
});

describe("applyUpgradeOrder", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("applies the target version to the live subscription and closes the order", async () => {
    m.repo.getById.mockImplementation(async (id: string) =>
      id === "order-1" ? ORDER : LIVE_SUB,
    );
    m.repo.update.mockImplementation(
      async (
        id: string,
        _before: SubscriptionRecord,
        input: { toPlanVersionId?: string; status?: string },
      ) => {
        if (id === "sub-old")
          return { ...LIVE_SUB, planVersionId: input.toPlanVersionId! };
        return { ...ORDER, status: "cancelled" };
      },
    );
    const result = await m.service.applyUpgradeOrder("order-1", "sub-old", {
      operatorId: "op-1",
    });
    // old row upgraded in place to the order's target version
    expect(result?.planVersionId).toBe("pv-2");
    // order row closed via a plain status update (never live → zero webhooks for it)
    expect(m.repo.update).toHaveBeenCalledWith(
      "order-1",
      ORDER,
      expect.objectContaining({ status: "cancelled" }),
    );
    expect(m.repo.activateOrder).not.toHaveBeenCalled();
  });

  it("falls back to activating the order when the target subscription is no longer active", async () => {
    m.repo.getById.mockImplementation(async (id: string) =>
      id === "order-1" ? ORDER : { ...LIVE_SUB, status: "expired" },
    );
    m.repo.activateOrder.mockResolvedValue(ACTIVE_ORDER);
    const result = await m.service.applyUpgradeOrder("order-1", "sub-old", {
      operatorId: "op-1",
    });
    expect(m.repo.activateOrder).toHaveBeenCalled();
    expect(result?.status).toBe("active");
  });

  it("rejects an order that is not pending", async () => {
    m.repo.getById.mockResolvedValue({ ...ORDER, status: "cancelled" });
    await expect(
      m.service.applyUpgradeOrder("order-1", "sub-old", { operatorId: "op-1" }),
    ).rejects.toThrow(/待支付状态/);
  });
});

describe("cancelPendingOrder", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  it("cancels the order and fires only the cache-bust (no deprovision)", async () => {
    m.repo.getById.mockResolvedValue(ORDER);
    m.repo.cancelOfflineOrder.mockResolvedValue({
      ...ORDER,
      status: "cancelled",
    });
    const result = await m.service.cancelPendingOrder("order-1", {
      actorType: "customer",
      actorId: "u-1",
    });
    expect(result.status).toBe("cancelled");
    expect(m.provisioning.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
  });

  it("an enqueue failure never fails the committed cancel", async () => {
    m.repo.getById.mockResolvedValue(ORDER);
    m.repo.cancelOfflineOrder.mockResolvedValue({
      ...ORDER,
      status: "cancelled",
    });
    m.provisioning.enqueueEvent.mockRejectedValue(new Error("db"));
    await expect(
      m.service.cancelPendingOrder("order-1", {
        actorType: "operator",
        actorId: "op-1",
      }),
    ).resolves.toMatchObject({ status: "cancelled" });
  });
});

describe("restoreOfflineOrder", () => {
  let m: Mocks;
  beforeEach(() => (m = build()));

  const CANCELLED_ORDER: SubscriptionRecord = { ...ORDER, status: "cancelled" };

  it("restores the order and fires only the cache-bust (no re-provisioning)", async () => {
    m.repo.getById.mockResolvedValue(CANCELLED_ORDER);
    m.repo.restoreOfflineOrder.mockResolvedValue({
      ...ORDER,
      status: "suspended",
    });
    const result = await m.service.restoreOfflineOrder("order-1", {
      actorType: "operator",
      actorId: "op-1",
    });
    expect(result.status).toBe("suspended");
    expect(m.repo.restoreOfflineOrder).toHaveBeenCalledWith(
      "order-1",
      expect.objectContaining({ actorType: "operator", actorId: "op-1" }),
    );
    expect(m.provisioning.enqueueEvent).toHaveBeenCalledTimes(1);
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
  });

  it("an enqueue failure never fails the committed restore", async () => {
    m.repo.getById.mockResolvedValue(CANCELLED_ORDER);
    m.repo.restoreOfflineOrder.mockResolvedValue({
      ...ORDER,
      status: "suspended",
    });
    m.provisioning.enqueueEvent.mockRejectedValue(new Error("db"));
    await expect(
      m.service.restoreOfflineOrder("order-1", {
        actorType: "operator",
        actorId: "op-1",
      }),
    ).resolves.toMatchObject({ status: "suspended" });
  });
});
