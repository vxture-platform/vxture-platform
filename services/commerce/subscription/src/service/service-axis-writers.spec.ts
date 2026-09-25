/**
 * service-axis-writers.spec.ts —— 服务轴新接上的两档与冻结收口（2026-09-25，批 2）。
 *
 * 被钉住的三件事，共同的病根是「值域里有、没人写」：
 *   1. `expiring` —— 到期提醒的邮件一直在发，状态从来没人写。客户收到信，回页面上看到的
 *      还是「服务中」。
 *   2. `overdue` —— 自动续费没付上，到期当天直接停服；3 天宽限只存在于续费单的 TTL 里，
 *      服务侧不认。
 *   3. `suspended` 永不到期 —— 到期扫描只扫在用三态，被冻结的行 end_at 过了也没人动它。
 *
 * 通知那一半也在这里钉：冻结中到期**不发**客户通知（服务早就停了，再说「已到期」只会
 * 让人以为又出了新状况），这条同时是 suspended 敢进扫描集合的前提——否则存量里所有过期
 * 的冻结行会在第一趟之后把邮件一次性发出去。
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSweepMocks,
  subscriptionFixture,
  type SweepMocks,
} from "./sweep-spec.helpers";

const VXTPL = {
  productId: "prod-vxtpl",
  productCode: "vxtpl",
  planCode: "vxtpl-starter",
};

const display = (id: string, status: string) => ({
  id,
  tenantId: "org-1",
  endAt: new Date("2026-09-20T00:00:00Z"),
  productName: "样板智能体",
  planName: "入门版",
  status,
});

describe("markOverdue：欠费宽限这一档的写入方", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(VXTPL)));

  it("没有候选 → 不写库、不发信、返回 0", async () => {
    await expect(m.service.markOverdue(3)).resolves.toBe(0);
    expect(m.repo.update).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("CAS 到扫描时读到的状态，并通知客户", async () => {
    m.repo.findOverdueCandidates.mockResolvedValue([display("s-1", "active")]);
    m.repo.getById.mockResolvedValue(subscriptionFixture({ id: "s-1" }));
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "overdue" }),
    );

    await expect(m.service.markOverdue(3)).resolves.toBe(1);
    expect(m.repo.update).toHaveBeenCalledWith(
      "s-1",
      expect.anything(),
      expect.objectContaining({ status: "overdue", expectedStatus: "active" }),
    );
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: "subscription.overdue" }),
    );
  });

  it("扫描之后行动了 → 不写、不发（输了竞态静默跳过）", async () => {
    m.repo.findOverdueCandidates.mockResolvedValue([display("s-1", "active")]);
    // 读回来已经是 cancelled：期间客户自己退订了。
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "cancelled" }),
    );

    await expect(m.service.markOverdue(3)).resolves.toBe(0);
    expect(m.repo.update).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("CAS 返回 0 行（别人先改了）→ 不算、不发", async () => {
    m.repo.findOverdueCandidates.mockResolvedValue([display("s-1", "active")]);
    m.repo.getById.mockResolvedValue(subscriptionFixture({ id: "s-1" }));
    m.repo.update.mockResolvedValue(null);

    await expect(m.service.markOverdue(3)).resolves.toBe(0);
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("单行失败不中断整趟", async () => {
    m.repo.findOverdueCandidates.mockResolvedValue([
      display("s-1", "active"),
      display("s-2", "active"),
    ]);
    m.repo.getById
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(subscriptionFixture({ id: "s-2" }));
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-2", status: "overdue" }),
    );

    await expect(m.service.markOverdue(3)).resolves.toBe(1);
  });
});

describe("notifyExpiringSoon：发信的同时把状态写成 expiring", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(VXTPL)));

  it("active 的行发信并 CAS 成 expiring", async () => {
    m.repo.findExpiringSoon.mockResolvedValue([display("s-1", "active")]);
    m.repo.getById.mockResolvedValue(subscriptionFixture({ id: "s-1" }));
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "expiring" }),
    );

    await expect(m.service.notifyExpiringSoon(3)).resolves.toEqual({
      notified: 1,
      marked: 1,
    });
    expect(m.repo.update).toHaveBeenCalledWith(
      "s-1",
      expect.anything(),
      expect.objectContaining({ status: "expiring", expectedStatus: "active" }),
    );
  });

  it("已经是 expiring 的行照发信但不再写库（窗口内每趟都会扫到同一批）", async () => {
    m.repo.findExpiringSoon.mockResolvedValue([display("s-1", "expiring")]);

    await expect(m.service.notifyExpiringSoon(3)).resolves.toEqual({
      notified: 1,
      marked: 0,
    });
    expect(m.repo.update).not.toHaveBeenCalled();
  });

  it("overdue 的行不被这一档盖掉——欠费是更强的陈述", async () => {
    m.repo.findExpiringSoon.mockResolvedValue([display("s-1", "overdue")]);

    await expect(m.service.notifyExpiringSoon(3)).resolves.toEqual({
      notified: 1,
      marked: 0,
    });
    expect(m.repo.update).not.toHaveBeenCalled();
  });
});

describe("到期扫描：冻结的行也要能走到终点，但不打扰客户", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(VXTPL)));

  it("宽限天数透传给仓库谓词（两处同源，不许各算各的）", async () => {
    await m.service.sweepExpiredSubscriptions(100, 3);
    expect(m.repo.findExpiredSubscriptionIds).toHaveBeenCalledWith(100, 3);
  });

  it("active 到期 → 转 expired 并通知", async () => {
    m.repo.findExpiredSubscriptionIds.mockResolvedValue([
      { id: "s-1", status: "active" },
    ]);
    m.repo.getById.mockResolvedValue(subscriptionFixture({ id: "s-1" }));
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "expired" }),
    );
    m.repo.getNotifyDisplay.mockResolvedValue(display("s-1", "expired"));

    await expect(m.service.sweepExpiredSubscriptions(100, 3)).resolves.toBe(1);
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: "subscription.expired" }),
    );
  });

  it("suspended 到期 → 同样转 expired，但一封信都不发", async () => {
    m.repo.findExpiredSubscriptionIds.mockResolvedValue([
      { id: "s-9", status: "suspended" },
    ]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-9", status: "suspended" }),
    );
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-9", status: "expired" }),
    );
    m.repo.getNotifyDisplay.mockResolvedValue(display("s-9", "expired"));

    await expect(m.service.sweepExpiredSubscriptions(100, 3)).resolves.toBe(1);
    expect(m.repo.update).toHaveBeenCalledWith(
      "s-9",
      expect.anything(),
      expect.objectContaining({
        status: "expired",
        expectedStatus: "suspended",
      }),
    );
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });
});
