import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSweepMocks,
  subscriptionFixture,
  type SweepMocks,
} from "./sweep-spec.helpers";

// Paid/free subscription expiry sweep (product_330 P2-c): every lapsed live
// subscription goes expired through the same transition tail as
// updateSubscription (deprovision + C2 invalidate); a CAS loser is skipped
// silently; a failing row never aborts the pass.

const paidSub = (id: string, status = "active") =>
  subscriptionFixture({
    id,
    status,
    cycleType: "year",
    startAt: new Date("2025-09-01T00:00:00Z"),
    endAt: new Date("2026-09-01T00:00:00Z"),
    payAmount: "0.10",
  });

describe("sweepExpiredSubscriptions", () => {
  let m: SweepMocks;
  beforeEach(
    () =>
      (m = buildSweepMocks({
        productId: "prod-vxtpl",
        productCode: "vxtpl",
        planCode: "vxtpl-starter",
      })),
  );

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
    m.repo.getById.mockResolvedValueOnce(paidSub("s-1"));
    m.repo.update.mockResolvedValueOnce(null);
    await expect(m.service.sweepExpiredSubscriptions()).resolves.toBe(0);
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
  });

  it("a row whose status already differs from the scan is skipped before any write", async () => {
    m.repo.findExpiredSubscriptionIds.mockResolvedValue([
      { id: "s-1", status: "active" },
    ]);
    m.repo.getById.mockResolvedValueOnce(paidSub("s-1", "cancelled"));
    await expect(m.service.sweepExpiredSubscriptions()).resolves.toBe(0);
    expect(m.repo.update).not.toHaveBeenCalled();
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
