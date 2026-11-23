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
      m.transaction,
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

  it("rolls back an outbox failure and notifies only a later committed row", async () => {
    m.repo.findOverdueCandidates.mockResolvedValue([
      display("bad", "active"),
      display("good", "active"),
    ]);
    m.repo.getById.mockImplementation(async (id: string) =>
      subscriptionFixture({ id }),
    );
    m.repo.update.mockImplementation(async (id: string) =>
      subscriptionFixture({ id, status: "overdue" }),
    );
    m.provisioning.enqueueEvent.mockRejectedValueOnce(
      new Error("outbox unavailable"),
    );
    m.notifier.notify.mockImplementation(async () => {
      expect(m.transactionEvents.at(-1)).toBe("commit");
    });
    expect(await m.service.markOverdue(3)).toBe(1);
    expect(m.transactionEvents).toEqual([
      "begin",
      "rollback",
      "begin",
      "commit",
    ]);
    expect(m.notifier.notify).toHaveBeenCalledOnce();
    expect(m.notifier.notify.mock.calls[0]![0].reference.id).toContain("good:");
  });

  it.each(["renewal-disabled", "converted-trial"])(
    "skips a stale %s overdue candidate",
    async (change) => {
      m.repo.findOverdueCandidates.mockResolvedValue([
        display("s-1", "active"),
      ]);
      m.repo.getById.mockResolvedValue(
        subscriptionFixture({
          autoRenew: change !== "renewal-disabled",
          subscriptionKind: change === "converted-trial" ? "trial" : "paid",
        }),
      );
      expect(await m.service.markOverdue(3)).toBe(0);
      expect(m.repo.update).not.toHaveBeenCalled();
      expect(m.notifier.notify).not.toHaveBeenCalled();
    },
  );
});

describe("notifyExpiringSoon：发信的同时把状态写成 expiring", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(VXTPL)));

  it("active 的行发信并 CAS 成 expiring", async () => {
    m.repo.findExpiringSoon.mockResolvedValue([display("s-1", "active")]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({
        id: "s-1",
        autoRenew: false,
        endAt: display("s-1", "active").endAt,
      }),
    );
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
      m.transaction,
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

  it("does not send a reminder for a failed transaction, but continues later rows", async () => {
    m.repo.findExpiringSoon.mockResolvedValue([
      display("bad", "active"),
      display("good", "active"),
    ]);
    m.repo.getById.mockImplementation(async (id: string) =>
      subscriptionFixture({ id, autoRenew: false }),
    );
    m.repo.update.mockImplementation(async (id: string) =>
      subscriptionFixture({ id, status: "expiring" }),
    );
    m.provisioning.enqueueEvent.mockRejectedValueOnce(
      new Error("outbox unavailable"),
    );
    m.notifier.notify.mockImplementation(async () => {
      expect(m.transactionEvents.at(-1)).toBe("commit");
    });
    expect(await m.service.notifyExpiringSoon(3)).toEqual({
      marked: 1,
      notified: 1,
    });
    expect(m.transactionEvents).toEqual([
      "begin",
      "rollback",
      "begin",
      "commit",
    ]);
    expect(m.notifier.notify).toHaveBeenCalledOnce();
    expect(m.notifier.notify.mock.calls[0]![0].reference.id).toContain("good:");
  });

  it.each(["renewal-enabled", "trial", "perpetual", "status-changed"])(
    "skips a stale %s expiry-window candidate before writing",
    async (change) => {
      m.repo.findExpiringSoon.mockResolvedValue([display("s-1", "active")]);
      m.repo.getById.mockResolvedValue(
        subscriptionFixture({
          autoRenew: change === "renewal-enabled",
          subscriptionKind: change === "trial" ? "trial" : "paid",
          cycleType: change === "perpetual" ? "perpetual" : "year",
          status: change === "status-changed" ? "suspended" : "active",
        }),
      );
      expect(await m.service.notifyExpiringSoon(3)).toEqual({
        marked: 0,
        notified: 0,
      });
      expect(m.repo.update).not.toHaveBeenCalled();
      expect(m.notifier.notify).not.toHaveBeenCalled();
    },
  );

  it("binds the reminder write to its scanned end date and does not notify on lost CAS", async () => {
    m.repo.findExpiringSoon.mockResolvedValue([display("s-1", "active")]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({
        autoRenew: false,
        endAt: new Date("2028-01-01T00:00:00Z"),
      }),
    );
    m.repo.update.mockResolvedValue(null);
    expect(await m.service.notifyExpiringSoon(3)).toEqual({
      marked: 0,
      notified: 0,
    });
    expect(m.repo.update).toHaveBeenCalledWith(
      "s-1",
      expect.anything(),
      expect.objectContaining({
        expectedEndAt: display("s-1", "active").endAt,
      }),
      m.transaction,
    );
    expect(m.provisioning.enqueueEvent).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("keeps the committed status count when customer notification fails", async () => {
    m.repo.findExpiringSoon.mockResolvedValue([display("s-1", "active")]);
    m.repo.getById.mockResolvedValue(subscriptionFixture({ autoRenew: false }));
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ status: "expiring" }),
    );
    m.notifier.notify.mockRejectedValue(
      new Error("customer channel unavailable"),
    );
    expect(await m.service.notifyExpiringSoon(3)).toEqual({
      marked: 1,
      notified: 0,
    });
    expect(m.transactionEvents).toEqual(["begin", "commit"]);
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
      m.transaction,
    );
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });
});

/*
 * 外部写路径（admin-bff 的裸 SQL）补跑写完成尾（批 5）。
 *
 * 钉三件事：退订真的会 deprovision、暂停只失效缓存不 deprovision（按设计——suspended
 * 既不在 ACTIVATED 也不在 DEACTIVATED，平台不停服，产品按信封里的状态自己停）、
 * 以及什么都没变时一个钩子都不发。
 */
describe("applyExternalStatusChange：裸 SQL 写完之后补跑同一套写完成尾", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(VXTPL)));

  it("active → cancelled：发 deprovision", async () => {
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "cancelled" }),
    );
    await m.service.applyExternalStatusChange("s-1", {
      status: "active",
      planVersionId: "pv-1",
    });
    expect(m.provisioning.onSubscriptionDeactivated).toHaveBeenCalled();
  });

  it("active → suspended：不 deprovision（平台不停服），但权益缓存要失效", async () => {
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "suspended" }),
    );
    await m.service.applyExternalStatusChange("s-1", {
      status: "active",
      planVersionId: "pv-1",
    });
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
    // 失效走 enqueueEvent（C2 信封作废）——这正是 admin 侧此前完全没做的那一半。
    expect(m.provisioning.enqueueEvent).toHaveBeenCalled();
  });

  it("suspended → active：发 provisioned（恢复要让产品重新起来）", async () => {
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await m.service.applyExternalStatusChange("s-1", {
      status: "suspended",
      planVersionId: "pv-1",
    });
    expect(m.provisioning.onSubscriptionActivated).toHaveBeenCalled();
  });

  it("状态与版本都没变：一个钩子都不发", async () => {
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await m.service.applyExternalStatusChange("s-1", {
      status: "active",
      planVersionId: "pv-1",
    });
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
    expect(m.provisioning.onSubscriptionDeactivated).not.toHaveBeenCalled();
    expect(m.provisioning.enqueueEvent).not.toHaveBeenCalled();
  });

  it("读不到订阅也不抛——运营动作已经生效，不该因为通知产品侧失败而回滚", async () => {
    m.repo.getById.mockResolvedValue(null);
    await expect(
      m.service.applyExternalStatusChange("gone", {
        status: "active",
        planVersionId: "pv-1",
      }),
    ).resolves.toBeUndefined();
  });
  it("same-status renewal invalidates products using the locked pre-write term", async () => {
    const endAt = new Date("2028-01-01T00:00:00Z");
    m.repo.getById.mockResolvedValue(subscriptionFixture({ endAt }));
    await m.service.applyExternalStatusChange(
      "s-1",
      {
        status: "active",
        planVersionId: "pv-1",
        endAt: new Date("2027-01-01T00:00:00Z"),
      },
      m.transaction,
    );
    expect(m.repo.getById).toHaveBeenCalledWith("s-1", m.transaction);
    expect(m.provisioning.enqueueEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "subscription_changed" }),
      m.transaction,
    );
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
    expect(m.transaction.query).not.toHaveBeenCalled();
    expect(m.transaction.release).not.toHaveBeenCalled();
  });

  it("known unchanged term leaves every product hook untouched", async () => {
    const endAt = new Date("2027-01-01T00:00:00Z");
    m.repo.getById.mockResolvedValue(subscriptionFixture({ endAt }));
    await m.service.applyExternalStatusChange(
      "s-1",
      { status: "active", planVersionId: "pv-1", endAt },
      m.transaction,
    );
    expect(m.provisioning.enqueueEvent).not.toHaveBeenCalled();
    expect(m.provisioning.onSubscriptionActivated).not.toHaveBeenCalled();
  });

  it.each(["read", "lifecycle", "outbox"])(
    "caller transaction propagates %s failure without transaction ownership",
    async (failure) => {
      m.repo.getById.mockResolvedValue(
        subscriptionFixture({ status: "active" }),
      );
      if (failure === "read")
        m.repo.getById.mockRejectedValue(new Error("required failure"));
      if (failure === "lifecycle")
        m.provisioning.onSubscriptionActivated.mockRejectedValue(
          new Error("required failure"),
        );
      if (failure === "outbox")
        m.provisioning.enqueueEvent.mockRejectedValue(
          new Error("required failure"),
        );
      await expect(
        m.service.applyExternalStatusChange(
          "s-1",
          { status: "suspended", planVersionId: "pv-1" },
          m.transaction,
        ),
      ).rejects.toThrow("required failure");
      expect(m.transaction.query).not.toHaveBeenCalled();
      expect(m.transaction.release).not.toHaveBeenCalled();
      expect(m.notifier.notify).not.toHaveBeenCalled();
    },
  );

  it("legacy caller still logs an enqueue failure without throwing", async () => {
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ status: "suspended" }),
    );
    m.provisioning.enqueueEvent.mockRejectedValue(new Error("legacy failure"));
    await expect(
      m.service.applyExternalStatusChange("s-1", {
        status: "active",
        planVersionId: "pv-1",
      }),
    ).resolves.toBeUndefined();
  });
});
