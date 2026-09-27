/**
 * product-maintenance-sweep.spec.ts —— 产品级维护窗口的批量暂停 / 恢复（2026-09-27）。
 *
 * owner 定：窗口进行中，该产品所有已订阅租户给时间补偿（暂停期间不计入有效期），恢复后
 * 结算；个例暂停机制不变。作业每 tick 对账，这一层要钉的是**顺序**与**幂等**，两件都不报错：
 *   ① 进窗口：CAS → 开 episode → 钩子 → 通知。episode 必须在 CAS 赢了之后才开（输了竞态
 *      还开一条，那条订阅会挂着一次「进行中」的暂停而状态不是 suspended）；episode 记的
 *      auto_renew_before 必须是暂停**那一刻**的值，expected_resume_at = 产品上的 maintenance_until。
 *   ② 出窗口：CAS → 闭合 → 钩子 → 结算 → 通知。先闭合再结算（结算的判据是「已闭合且未
 *      结算」），恢复要还原暂停那一刻的续费意愿，episode 没记（null）就不动。
 *   ③ 幂等靠判据：仓储按「有无未闭合 episode」筛候选，第二趟 0 条；单行失败不中断整趟。
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

const WINDOW = "win-1";
const UNTIL = new Date("2026-09-28T02:00:00Z");

const candidate = (over: Record<string, unknown> = {}) => ({
  subscriptionId: "s-1",
  tenantId: "org-1",
  status: "active",
  autoRenew: true,
  productId: "prod-vxtpl",
  maintenanceWindowId: WINDOW,
  maintenanceUntil: UNTIL,
  ...over,
});

const release = (over: Record<string, unknown> = {}) => ({
  id: "sus-1",
  subscriptionId: "s-1",
  status: "suspended",
  autoRenewBefore: true,
  maintenanceWindowId: WINDOW,
  ...over,
});

const display = (status: string) => ({
  id: "s-1",
  tenantId: "org-1",
  endAt: new Date("2026-10-20T00:00:00Z"),
  productName: "样板智能体",
  planName: "入门版",
  status,
});

describe("进窗口：产品名下在服务中的订阅批量暂停", () => {
  let m: SweepMocks;
  beforeEach(() => {
    m = buildSweepMocks(VXTPL);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active", autoRenew: true }),
    );
  });

  it("没有候选 → 不写库；顺延同步仍跑一次", async () => {
    await expect(m.service.sweepProductMaintenance()).resolves.toEqual({
      suspended: 0,
      resumed: 0,
      synced: 0,
    });
    expect(m.repo.update).not.toHaveBeenCalled();
    expect(m.repo.openSuspension).not.toHaveBeenCalled();
    expect(m.repo.syncMaintenanceExpectedResume).toHaveBeenCalledTimes(1);
  });

  it("顺序：CAS 到 suspended → 开 episode → 钩子 → 通知", async () => {
    const order: string[] = [];
    m.repo.findMaintenanceCandidates.mockResolvedValue([candidate()]);
    m.repo.update.mockImplementation(async () => {
      order.push("cas");
      return subscriptionFixture({ id: "s-1", status: "suspended" });
    });
    m.repo.openSuspension.mockImplementation(async () => {
      order.push("open");
      return "sus-new";
    });
    m.provisioning.enqueueEvent.mockImplementation(async () => {
      order.push("hooks");
      return "d-evt";
    });
    m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
    m.notifier.notify.mockImplementation(async () => {
      order.push("notify");
    });

    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      suspended: 1,
    });
    expect(order).toEqual(["cas", "open", "hooks", "notify"]);
  });

  it("CAS 带 expectedStatus = 扫到时的状态；冻结期间关掉自动续费；备注带窗口 id", async () => {
    m.repo.findMaintenanceCandidates.mockResolvedValue([
      candidate({ status: "expiring" }),
    ]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "expiring" }),
    );
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "suspended" }),
    );
    await m.service.sweepProductMaintenance();
    expect(m.repo.update.mock.calls[0]?.[2]).toMatchObject({
      status: "suspended",
      autoRenew: false,
      operatorType: "system",
      expectedStatus: "expiring",
    });
    const remark = (
      m.repo.update.mock.calls[0]?.[2] as { operatorRemark: string }
    ).operatorRemark;
    expect(remark).toContain(WINDOW);
  });

  it("episode：platform_ops / 顺延 / actor system / 带窗口 id / 预计恢复 = maintenance_until / 记暂停前的续费意愿", async () => {
    m.repo.findMaintenanceCandidates.mockResolvedValue([candidate()]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active", autoRenew: false }),
    );
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "suspended" }),
    );
    await m.service.sweepProductMaintenance();
    expect(m.repo.openSuspension).toHaveBeenCalledWith({
      subscriptionId: "s-1",
      tenantId: "org-1",
      reason: "platform_ops",
      extendsTerm: true,
      // false 也要记 false：恢复时无脑置 true 会给关着自动续费的客户悄悄打开它。
      autoRenewBefore: false,
      expectedResumeAt: UNTIL,
      actorType: "system",
      maintenanceWindowId: WINDOW,
    });
  });

  it("扫到之后状态变了（别的路径动过）→ 跳过，不 clobber", async () => {
    m.repo.findMaintenanceCandidates.mockResolvedValue([candidate()]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "cancelled" }),
    );
    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      suspended: 0,
    });
    expect(m.repo.update).not.toHaveBeenCalled();
    expect(m.repo.openSuspension).not.toHaveBeenCalled();
  });

  it("CAS 输了（update 回 null）→ 不开 episode、不发信", async () => {
    m.repo.findMaintenanceCandidates.mockResolvedValue([candidate()]);
    m.repo.update.mockResolvedValue(null);
    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      suspended: 0,
    });
    expect(m.repo.openSuspension).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("幂等：已经有未闭合 episode 的订阅不再是候选，第二趟 0 条", async () => {
    // 仓储的判据是「没有未闭合 episode」——这里让 fake 仓储照那条判据行事。
    const open = new Set<string>();
    m.repo.findMaintenanceCandidates.mockImplementation(async () =>
      [candidate()].filter((c) => !open.has(c.subscriptionId)),
    );
    m.repo.openSuspension.mockImplementation(
      async (input: { subscriptionId: string }) => {
        open.add(input.subscriptionId);
        return "sus-new";
      },
    );
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "suspended" }),
    );

    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      suspended: 1,
    });
    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      suspended: 0,
    });
    expect(m.repo.openSuspension).toHaveBeenCalledTimes(1);
    expect(m.repo.update).toHaveBeenCalledTimes(1);
  });

  it("一条失败（开 episode 抛错）不中断整趟，下一条照常", async () => {
    m.repo.findMaintenanceCandidates.mockResolvedValue([
      candidate({ subscriptionId: "s-1" }),
      candidate({ subscriptionId: "s-2" }),
    ]);
    m.repo.getById.mockImplementation(async (id: string) =>
      subscriptionFixture({ id, status: "active" }),
    );
    m.repo.update.mockImplementation(async (id: string) =>
      subscriptionFixture({ id, status: "suspended" }),
    );
    m.repo.openSuspension
      .mockRejectedValueOnce(new Error("duplicate key (uidx open)"))
      .mockResolvedValueOnce("sus-2");
    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      suspended: 1,
    });
    expect(m.repo.update).toHaveBeenCalledTimes(2);
  });

  it("告诉客户「订阅已暂停」", async () => {
    m.repo.findMaintenanceCandidates.mockResolvedValue([candidate()]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "suspended" }),
    );
    m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
    await m.service.sweepProductMaintenance();
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: "subscription.suspended" }),
    );
  });
});

describe("出窗口：产品不再打着那个窗口 → 恢复并结算", () => {
  let m: SweepMocks;
  beforeEach(() => {
    m = buildSweepMocks(VXTPL);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "suspended", autoRenew: false }),
    );
  });

  it("顺序：CAS 到 active → 闭合 episode → 钩子 → 结算 → 通知", async () => {
    const order: string[] = [];
    m.repo.findMaintenanceReleases.mockResolvedValue([release()]);
    m.repo.update.mockImplementation(async () => {
      order.push("cas");
      return subscriptionFixture({ id: "s-1", status: "active" });
    });
    m.repo.closeSuspension.mockImplementation(async () => {
      order.push("close");
    });
    // suspended → active 是「重新进入在用」：钩子会发 provisioned。
    m.provisioning.onSubscriptionActivated.mockImplementation(async () => {
      order.push("hooks");
      return { deliveryId: "d", seq: 1 };
    });
    m.repo.settleResumedSuspensions.mockImplementation(async () => {
      order.push("settle");
      return [];
    });
    m.repo.getNotifyDisplay.mockResolvedValue(display("active"));
    m.notifier.notify.mockImplementation(async () => {
      order.push("notify");
    });

    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      resumed: 1,
    });
    expect(order).toEqual(["cas", "close", "hooks", "settle", "notify"]);
    expect(m.repo.settleResumedSuspensions).toHaveBeenCalledWith({
      subscriptionId: "s-1",
      limit: 100,
    });
  });

  it("CAS 从 suspended 出发，还原暂停那一刻的续费意愿（false 也还原成 false）", async () => {
    m.repo.findMaintenanceReleases.mockResolvedValue([
      release({ autoRenewBefore: false }),
    ]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await m.service.sweepProductMaintenance();
    expect(m.repo.update.mock.calls[0]?.[2]).toMatchObject({
      status: "active",
      autoRenew: false,
      operatorType: "system",
      expectedStatus: "suspended",
    });
  });

  it("episode 没记续费意愿（null）→ 整个键不出现，不动它", async () => {
    m.repo.findMaintenanceReleases.mockResolvedValue([
      release({ autoRenewBefore: null }),
    ]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await m.service.sweepProductMaintenance();
    const input = m.repo.update.mock.calls[0]?.[2] as Record<string, unknown>;
    expect("autoRenew" in input).toBe(false);
  });

  it("扫到之后已经不是 suspended（运营手工恢复过）→ 跳过", async () => {
    m.repo.findMaintenanceReleases.mockResolvedValue([release()]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      resumed: 0,
    });
    expect(m.repo.update).not.toHaveBeenCalled();
    expect(m.repo.closeSuspension).not.toHaveBeenCalled();
  });

  it("CAS 输了 → 不闭合、不结算、不发信", async () => {
    m.repo.findMaintenanceReleases.mockResolvedValue([release()]);
    m.repo.update.mockResolvedValue(null);
    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      resumed: 0,
    });
    expect(m.repo.closeSuspension).not.toHaveBeenCalled();
    expect(m.repo.settleResumedSuspensions).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("告诉客户「已恢复」", async () => {
    m.repo.findMaintenanceReleases.mockResolvedValue([release()]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    m.repo.getNotifyDisplay.mockResolvedValue(display("active"));
    await m.service.sweepProductMaintenance();
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: "subscription.resumed" }),
    );
  });
});

describe("顺延同步：窗口 maintenance_until 变了", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(VXTPL)));

  it("改了几条就报几条", async () => {
    m.repo.syncMaintenanceExpectedResume.mockResolvedValue(3);
    await expect(m.service.sweepProductMaintenance()).resolves.toEqual({
      suspended: 0,
      resumed: 0,
      synced: 3,
    });
  });

  it("同步失败只记日志，前两段已生效的计数不受影响", async () => {
    m.repo.findMaintenanceReleases.mockResolvedValue([release()]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "suspended" }),
    );
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    m.repo.syncMaintenanceExpectedResume.mockRejectedValue(new Error("db"));
    await expect(m.service.sweepProductMaintenance()).resolves.toEqual({
      suspended: 0,
      resumed: 1,
      synced: 0,
    });
  });
});
