import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionService } from "./subscription.service";
import type { PgSubscriptionRepository } from "../repository/pg-subscription.repository";
import type { ProvisioningService } from "@vxture/service-provisioning";
import type { SubscriptionRecord } from "../types/subscription.types";

// Paid/free subscription expiry sweep (product_330 P2-c): repo + provisioning
// are mocked; the subject is the loop — every lapsed live subscription goes
// expired through the same transition tail as updateSubscription (deprovision
// + C2 invalidate), a CAS loser is skipped silently, a failing row never
// aborts the pass.

const paidSub = (id: string, status = "active"): SubscriptionRecord => ({
  id,
  tenantId: "org-1",
  workspaceId: "ws-1",
  planVersionId: "pv-1",
  cycleType: "year",
  cycleCount: 1,
  startAt: new Date("2025-09-01T00:00:00Z"),
  endAt: new Date("2026-09-01T00:00:00Z"),
  trialEndAt: null,
  status,
  subscriptionKind: "paid",
  activationMethod: "offline_purchase",
  autoRenew: true,
  orderNo: "ORD-1",
  payAmount: "0.10",
  currency: "CNY",
  createdBy: "u-1",
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});

const VXTPL = {
  productId: "prod-vxtpl",
  productCode: "vxtpl",
  planCode: "vxtpl-starter",
};

const build = () => {
  const repo = {
    update: vi.fn(),
    getById: vi.fn(),
    findExpiredSubscriptionIds: vi.fn().mockResolvedValue([]),
    listVersionProducts: vi.fn().mockResolvedValue([VXTPL]),
    hasOtherActiveCoverage: vi.fn().mockResolvedValue(false),
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
    { reserveForOrder: async () => [] } as never,
  );
  return { repo, provisioning, service };
};

describe("sweepExpiredSubscriptions", () => {
  let m: ReturnType<typeof build>;
  beforeEach(() => (m = build()));

  it("nothing lapsed → no writes, returns 0", async () => {
    await expect(m.service.sweepExpiredSubscriptions()).resolves.toBe(0);
    expect(m.repo.update).not.toHaveBeenCalled();
  });

  it("flips each lapsed live subscription to expired with a CAS on its scanned status", async () => {
    m.repo.findExpiredSubscriptionIds.mockResolvedValue([
      { id: "s-1", status: "active" },
      { id: "s-2", status: "overdue" },
    ]);
    m.repo.getById
      .mockResolvedValueOnce(paidSub("s-1"))
      .mockResolvedValueOnce(paidSub("s-2", "overdue"));
    m.repo.update
      .mockResolvedValueOnce(paidSub("s-1", "expired"))
      .mockResolvedValueOnce(paidSub("s-2", "expired"));
    await expect(m.service.sweepExpiredSubscriptions()).resolves.toBe(2);
    expect(m.repo.update).toHaveBeenCalledWith(
      "s-2",
      expect.objectContaining({ status: "overdue" }),
      expect.objectContaining({
        status: "expired",
        operatorType: "system",
        expectedStatus: "overdue",
      }),
    );
    // active → expired with no other coverage: deprovision + invalidate fire
    expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalled();
    expect(m.provisioning.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "subscription_changed" }),
    );
  });

  it("a row renewed between scan and write (status moved) is skipped without hooks", async () => {
    m.repo.findExpiredSubscriptionIds.mockResolvedValue([
      { id: "s-1", status: "active" },
    ]);
    // renewal fulfilled meanwhile: still active but end_at moved — CAS no-op
    m.repo.getById.mockResolvedValueOnce(paidSub("s-1"));
    m.repo.update.mockResolvedValueOnce(null);
    await expect(m.service.sweepExpiredSubscriptions()).resolves.toBe(0);
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });

  it("a failing row is logged and skipped; the pass continues", async () => {
    m.repo.findExpiredSubscriptionIds.mockResolvedValue([
      { id: "bad", status: "active" },
      { id: "good", status: "active" },
    ]);
    m.repo.getById
      .mockRejectedValueOnce(new Error("row gone"))
      .mockResolvedValueOnce(paidSub("good"));
    m.repo.update.mockResolvedValueOnce(paidSub("good", "expired"));
    await expect(m.service.sweepExpiredSubscriptions()).resolves.toBe(1);
  });
});
