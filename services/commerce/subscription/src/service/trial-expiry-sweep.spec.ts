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

/* ── 试用到期通知（2026-09-28 批 5）────────────────────────────────────────────
 *
 * 此前这一趟把转移过的行丢掉只返回条数，于是试用结束客户一句话都收不到；付费到期
 * 那一支早就在发。这一组钉四件事：只对真的发生了的转移发、日期取**试用**截止日、
 * 通知炸了不影响业务结果、客户看得见的那部分不出现 uuid。
 */
const TRIAL_UUID = "11111111-1111-4111-8111-111111111111";
const UUID_SHAPE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const trialDisplay = (over: Record<string, unknown> = {}) => ({
  id: TRIAL_UUID,
  tenantId: "org-1",
  /* 试用行的 end_at 常为 NULL——付费周期还没开始。 */
  endAt: null,
  trialEndAt: new Date("2026-07-01T00:00:00Z"),
  productName: "Arda",
  planName: "Arda 试用版",
  status: "expired",
  ...over,
});

describe("sweepLapsedTrials —— 客户通知", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(ARDA)));

  const oneLapsedTrial = () => {
    m.repo.findLapsedTrialIds.mockResolvedValue([TRIAL_UUID]);
    m.repo.getById.mockResolvedValueOnce(trialSub(TRIAL_UUID));
    m.repo.update.mockResolvedValueOnce(trialSub(TRIAL_UUID, "expired"));
  };

  it("一次真的转移 → 一封 subscription.trial_expired，日期与去重键都按试用截止日", async () => {
    oneLapsedTrial();
    m.repo.getNotifyDisplay.mockResolvedValue(trialDisplay());
    await expect(m.service.sweepLapsedTrials()).resolves.toBe(1);
    expect(m.notifier.notify).toHaveBeenCalledTimes(1);
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "org-1",
        templateCode: "subscription.trial_expired",
        /* 去重键的日期是 trial_end_at 那一天，不是「今天」（endAt 为 NULL 时的回落）。 */
        reference: { type: "subscription", id: `${TRIAL_UUID}:2026-07-01` },
        params: expect.objectContaining({
          productName: "Arda",
          planName: "Arda 试用版",
          endAt: "2026-07-01",
        }),
        link: "/subscription",
      }),
    );
  });

  it("客户看得见的那一半不出现 uuid（引用键是去重用的，不上屏）", async () => {
    oneLapsedTrial();
    m.repo.getNotifyDisplay.mockResolvedValue(trialDisplay());
    await m.service.sweepLapsedTrials();
    const input = m.notifier.notify.mock.calls[0]![0];
    expect(JSON.stringify(input.params)).not.toMatch(UUID_SHAPE);
    expect(String(input.link)).not.toMatch(UUID_SHAPE);
  });

  it("转移没发生（CAS 输了）一封都不发", async () => {
    m.repo.findLapsedTrialIds.mockResolvedValue([TRIAL_UUID]);
    m.repo.getById.mockResolvedValueOnce(trialSub(TRIAL_UUID));
    m.repo.update.mockResolvedValueOnce(null);
    m.repo.getNotifyDisplay.mockResolvedValue(trialDisplay());
    await expect(m.service.sweepLapsedTrials()).resolves.toBe(0);
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("展示数据取不到就不发，也不报错（并发删了之类）", async () => {
    oneLapsedTrial();
    m.repo.getNotifyDisplay.mockResolvedValue(null);
    await expect(m.service.sweepLapsedTrials()).resolves.toBe(1);
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("notifier 抛异常：业务结果不变，本趟不中断", async () => {
    m.repo.findLapsedTrialIds.mockResolvedValue([TRIAL_UUID, "t-2"]);
    m.repo.getById
      .mockResolvedValueOnce(trialSub(TRIAL_UUID))
      .mockResolvedValueOnce(trialSub("t-2"));
    m.repo.update
      .mockResolvedValueOnce(trialSub(TRIAL_UUID, "expired"))
      .mockResolvedValueOnce(trialSub("t-2", "expired"));
    m.repo.getNotifyDisplay.mockResolvedValue(trialDisplay());
    m.notifier.notify.mockRejectedValue(new Error("smtp down"));
    await expect(m.service.sweepLapsedTrials()).resolves.toBe(2);
    expect(m.notifier.notify).toHaveBeenCalledTimes(2);
  });
});
