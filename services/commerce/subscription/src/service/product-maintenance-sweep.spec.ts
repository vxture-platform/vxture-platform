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

  /**
   * 通知那一半（2026-09-28 收尾）。此前发的是 `subscription.suspended`——**给人工暂停写的
   * 那条**，正文说「如需恢复请联系客服」。维护暂停是第 2 段自己放回来的，那句话是假话，
   * 还白造工单。这一组钉的是「发对的那条 + 键的粒度」。
   */
  describe("告诉客户：因升级维护暂停，不是人工暂停那条", () => {
    const pausedFor = async (until: Date) => {
      m.repo.findMaintenanceCandidates.mockResolvedValue([
        candidate({ maintenanceUntil: until }),
      ]);
      m.repo.update.mockResolvedValue(
        subscriptionFixture({ id: "s-1", status: "suspended" }),
      );
      m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
      await m.service.sweepProductMaintenance();
      return m.notifier.notify.mock.calls[0]?.[0] as {
        templateCode: string;
        reference: { type: string; id: string };
        params: Record<string, string | number>;
        link?: string;
      };
    };

    it("发维护专属那条，人工暂停那条一次都不发", async () => {
      const input = await pausedFor(UNTIL);
      expect(input.templateCode).toBe("subscription.suspended_maintenance");
      expect(m.notifier.notify).not.toHaveBeenCalledWith(
        expect.objectContaining({ templateCode: "subscription.suspended" }),
      );
    });

    it("文案带预计恢复时间（= 产品上的 maintenance_until，按 Asia/Shanghai 的日历日）", async () => {
      // 02:00Z = 上海当日 10:00。客户看的是本地日历日，不是 UTC 时刻。
      const input = await pausedFor(UNTIL);
      expect(input.params.resumeAt).toBe("2026-09-28");
      expect(input.link).toBe("/subscription");
    });

    it("去重锚 = 订阅 × **预计恢复日期**（不是订阅 × 到期日）", async () => {
      const input = await pausedFor(UNTIL);
      expect(input.reference).toEqual({
        type: "subscription",
        id: "s-1:2026-09-28",
      });
    });

    /* 第 3 段（顺延同步）为什么不必自己发通知：窗口一延长，预计恢复日期变了，收件箱那个
       唯一键（account × 模板 × 引用类型 × 引用 id）就不再命中，同一条模板自然再发一条带
       新日期的。所以这三条断言测的是「延长会不会再通知」这件产品行为。 */
    it("窗口延长到另一天 → 引用 id 跟着变（客户会收到带新日期的第二条）", async () => {
      const first = await pausedFor(UNTIL);
      m.notifier.notify.mockClear();
      const second = await pausedFor(new Date("2026-09-30T02:00:00Z"));
      expect(second.params.resumeAt).toBe("2026-09-30");
      expect(second.reference.id).not.toBe(first.reference.id);
    });

    it("只挪了时刻、客户看到的日子没变 → 引用 id 不变（不重复打扰）", async () => {
      const first = await pausedFor(UNTIL);
      m.notifier.notify.mockClear();
      // 15:30Z = 上海当日 23:30，仍是 2026-09-28。
      const second = await pausedFor(new Date("2026-09-28T15:30:00Z"));
      expect(second.params.resumeAt).toBe("2026-09-28");
      expect(second.reference.id).toBe(first.reference.id);
    });

    it("同一个 UTC 日、上海跨了日 → 键要变：键与文案里的日子必须是同一个", async () => {
      // 16:30Z 还是 09-28（UTC），上海已经是 09-29 —— 客户屏幕上的日子变了。键若按
      // toISOString 算就不会变，于是「屏幕上的日子变了却不再通知」。
      const first = await pausedFor(UNTIL);
      m.notifier.notify.mockClear();
      const second = await pausedFor(new Date("2026-09-28T16:30:00Z"));
      expect(second.params.resumeAt).toBe("2026-09-29");
      expect(second.reference.id).toBe("s-1:2026-09-29");
      expect(second.reference.id).not.toBe(first.reference.id);
    });

    it("通知发不出去不影响这一趟：仍算暂停成功，不中断", async () => {
      m.repo.findMaintenanceCandidates.mockResolvedValue([candidate()]);
      m.repo.update.mockResolvedValue(
        subscriptionFixture({ id: "s-1", status: "suspended" }),
      );
      m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
      m.notifier.notify.mockRejectedValue(new Error("smtp down"));
      await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
        suspended: 1,
      });
    });
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

  /* 恢复那条**没动**：2026-09-28 收尾只拆了「暂停」那一条。恢复仍是共同形状（引用 =
     订阅 × 到期日），不带预计恢复日期——那件事到这一刻已经结束了。 */
  it("恢复通知未被改动：仍是 subscription.resumed，引用仍按到期日", async () => {
    m.repo.findMaintenanceReleases.mockResolvedValue([release()]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    m.repo.getNotifyDisplay.mockResolvedValue(display("active"));
    await m.service.sweepProductMaintenance();
    expect(m.notifier.notify.mock.calls[0]?.[0]).toMatchObject({
      templateCode: "subscription.resumed",
      reference: { type: "subscription", id: "s-1:2026-10-20" },
      link: "/subscription",
    });
  });
});

/**
 * 两条暂停模板的分岔（2026-09-28 收尾）。判据是**暂停原因**：维护那条腿开的 episode 写
 * `platform_ops`，运营手工暂停走的是 admin-bff 那条裸 SQL 事务（原因由运营自己选），提交后
 * 调 `notifyOperatorStatusChange`。人工暂停仍发原来那条——它的「如需恢复请联系客服」对人工
 * 暂停是**对的**，只有运营放得开。
 */
describe("人工暂停与维护暂停是两条模板", () => {
  let m: SweepMocks;
  beforeEach(() => {
    m = buildSweepMocks(VXTPL);
  });

  it("运营人工暂停仍发 subscription.suspended（共同形状，引用按到期日）", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
    await m.service.notifyOperatorStatusChange("s-1", "suspended");
    expect(m.notifier.notify).toHaveBeenCalledTimes(1);
    expect(m.notifier.notify.mock.calls[0]?.[0]).toMatchObject({
      templateCode: "subscription.suspended",
      reference: { type: "subscription", id: "s-1:2026-10-20" },
    });
  });

  it("人工暂停不会发成维护那条", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
    await m.service.notifyOperatorStatusChange("s-1", "suspended");
    expect(m.notifier.notify).not.toHaveBeenCalledWith(
      expect.objectContaining({
        templateCode: "subscription.suspended_maintenance",
      }),
    );
  });
});

describe("顺延同步：窗口 maintenance_until 变了", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(VXTPL)));

  /** 顺延同步回送的行（= 那一条 UPDATE 的 returning）。 */
  const shift = (subscriptionId: string, expectedResumeAt: Date | null) => ({
    subscriptionId,
    expectedResumeAt,
  });

  it("改了几条就报几条", async () => {
    m.repo.syncMaintenanceExpectedResume.mockResolvedValue([
      shift("s-1", UNTIL),
      shift("s-2", UNTIL),
      shift("s-3", UNTIL),
    ]);
    await expect(m.service.sweepProductMaintenance()).resolves.toEqual({
      suspended: 0,
      resumed: 0,
      synced: 3,
    });
  });

  /* 此前这一段**一句话都不发**：承诺的回来时间变了，被承诺的人不知道。第 1 段的候选查询
     排除「有未闭合 episode」的订阅，所以已经停着的行永远不会再被它扫到——光有去重锚的
     粒度不会自己再发一条，这一段必须自己发。发的还是同一条模板，只是带着新日期。 */
  it("延长之后告诉客户新的预计恢复时间（同一条模板，带新日期）", async () => {
    m.repo.syncMaintenanceExpectedResume.mockResolvedValue([
      shift("s-1", new Date("2026-09-30T02:00:00Z")),
    ]);
    m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
    await m.service.sweepProductMaintenance();
    expect(m.notifier.notify).toHaveBeenCalledTimes(1);
    expect(m.notifier.notify.mock.calls[0]?.[0]).toMatchObject({
      templateCode: "subscription.suspended_maintenance",
      // 去重锚跟着新日期走 ⇒ 收件箱唯一键不再命中 ⇒ 这条真的会落库。
      reference: { type: "subscription", id: "s-1:2026-09-30" },
      params: { resumeAt: "2026-09-30" },
    });
  });

  it("被改的每一行各通知一次", async () => {
    m.repo.syncMaintenanceExpectedResume.mockResolvedValue([
      shift("s-1", UNTIL),
      shift("s-2", UNTIL),
    ]);
    m.repo.getNotifyDisplay.mockImplementation(async (id: string) => ({
      ...display("suspended"),
      id,
    }));
    await m.service.sweepProductMaintenance();
    expect(m.notifier.notify).toHaveBeenCalledTimes(2);
    expect(
      m.notifier.notify.mock.calls.map(
        (c) => (c[0] as { reference: { id: string } }).reference.id,
      ),
    ).toEqual(["s-1:2026-09-28", "s-2:2026-09-28"]);
  });

  it("窗口还打着但 maintenance_until 被清空 → 不发「预计 — 恢复」这种信", async () => {
    m.repo.syncMaintenanceExpectedResume.mockResolvedValue([
      shift("s-1", null),
    ]);
    m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      synced: 1,
    });
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("通知发不出去不影响 synced 计数", async () => {
    m.repo.syncMaintenanceExpectedResume.mockResolvedValue([
      shift("s-1", UNTIL),
    ]);
    m.repo.getNotifyDisplay.mockResolvedValue(display("suspended"));
    m.notifier.notify.mockRejectedValue(new Error("smtp down"));
    await expect(m.service.sweepProductMaintenance()).resolves.toMatchObject({
      synced: 1,
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
