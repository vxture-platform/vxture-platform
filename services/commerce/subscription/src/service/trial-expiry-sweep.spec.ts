import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSweepMocks,
  subscriptionFixture,
  type SweepMocks,
} from "./sweep-spec.helpers";

// Trial-expiry sweep unit tests (product_310 D10): repo + provisioning are
// mocked; the subject is the sweep loop — each lapsed trial goes through
// updateSubscription (so the status-transition wiring fires) and a per-row
// failure never aborts the pass.

const trialSub = (id: string, status = "trialing") =>
  subscriptionFixture({
    id,
    status,
    trialEndAt: new Date("2026-07-01T00:00:00Z"),
    subscriptionKind: "trial",
    activationMethod: "trial",
    autoRenew: false,
  });

const ARDA = {
  productId: "prod-arda",
  productCode: "arda",
  planCode: "arda-beta-trial",
};

describe("sweepLapsedTrials", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(ARDA)));

  it("no lapsed trials → no writes, returns 0", async () => {
    await expect(m.service.sweepLapsedTrials()).resolves.toBe(0);
    expect(m.repo.update).not.toHaveBeenCalled();
  });

  it("transitions each lapsed trial to expired with the system actor", async () => {
    m.repo.findLapsedTrialIds.mockResolvedValue(["t-1", "t-2"]);
    for (const id of ["t-1", "t-2"]) {
      m.repo.getById.mockResolvedValueOnce(trialSub(id));
      m.repo.update.mockResolvedValueOnce(trialSub(id, "expired"));
    }
    await expect(m.service.sweepLapsedTrials()).resolves.toBe(2);
    expect(m.repo.update).toHaveBeenCalledTimes(2);
    expect(m.repo.update).toHaveBeenCalledWith(
      "t-1",
      expect.objectContaining({ status: "trialing" }),
      expect.objectContaining({ status: "expired", operatorType: "system" }),
    );
  });

  it("fires the deprovision check via the existing transition wiring", async () => {
    m.repo.findLapsedTrialIds.mockResolvedValue(["t-1"]);
    m.repo.getById.mockResolvedValueOnce(trialSub("t-1"));
    m.repo.update.mockResolvedValueOnce(trialSub("t-1", "expired"));
    await m.service.sweepLapsedTrials();
    // trialing (ACTIVATED) → expired (DEACTIVATED) with no other coverage
    expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalledTimes(1);
    // and the subscription_changed C2 invalidate fan-out fires
    expect(m.provisioning.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "subscription_changed" }),
    );
  });

  it("a row that lost the trialing→expired race (CAS guard) is skipped without firing hooks", async () => {
    m.repo.findLapsedTrialIds.mockResolvedValue(["t-1"]);
    m.repo.getById.mockResolvedValueOnce(trialSub("t-1"));
    // a concurrent admin action (e.g. renew) flipped the row first — the
    // guarded update matches 0 rows and returns null.
    m.repo.update.mockResolvedValueOnce(null);
    await expect(m.service.sweepLapsedTrials()).resolves.toBe(0);
    expect(m.repo.update).toHaveBeenCalledWith(
      "t-1",
      expect.anything(),
      expect.objectContaining({ expectedStatus: "trialing" }),
    );
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
    expect(m.provisioning.enqueueEvent).not.toHaveBeenCalled();
  });

  it("a failing row is logged and skipped; the pass continues", async () => {
    m.repo.findLapsedTrialIds.mockResolvedValue(["t-bad", "t-good"]);
    m.repo.getById
      .mockRejectedValueOnce(new Error("row gone"))
      .mockResolvedValueOnce(trialSub("t-good"));
    m.repo.update.mockResolvedValueOnce(trialSub("t-good", "expired"));
    await expect(m.service.sweepLapsedTrials()).resolves.toBe(1);
    expect(m.repo.update).toHaveBeenCalledTimes(1);
  });

  it("passes the batch limit through to the repository", async () => {
    await m.service.sweepLapsedTrials(25);
    expect(m.repo.findLapsedTrialIds).toHaveBeenCalledWith(25);
  });
});
