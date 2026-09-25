/**
 * suspension-term-extension.spec.ts —— 暂停顺延（2026-09-25 步骤三）。
 *
 * owner 定的三条前提：不做退钱、客户不承担暂停期间的代价、暂停是平台动作。前两条合起来
 * 就是这条线：不退钱，就把停掉的那些天还回去。
 *
 * 这一层要钉的是**到点处置的分岔**与**结算不会静默丢账**，两件都不报错：
 *   ① 平台原因到点强制恢复、客户违规到点终止。搞反了不会有任何异常——只是违规者白得一段
 *      服务，或者受害客户被平台自己拖到终止。
 *   ② 恢复要还原**暂停那一刻**的续费意愿。无脑置 true 会给本来关着自动续费的客户悄悄打开
 *      它（下个周期账上多一笔）；不还原等于运营暂停一次就替客户永久关掉了自动续费。
 *      存量 episode 没有这个值（列是后加的）→ 不动它，而不是猜。
 *   ③ 顺延是欠客户的账：结算失败不能让恢复动作失败，也不能静默吞掉——判据是
 *      granted_seconds is null，下一趟自愈。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const episode = (over: Record<string, unknown> = {}) => ({
  id: "sus-1",
  subscriptionId: "s-1",
  status: "suspended",
  reason: "platform_ops",
  extendsTerm: true,
  autoRenewBefore: true,
  ...over,
});

const display = (status: string) => ({
  id: "s-1",
  tenantId: "org-1",
  endAt: new Date("2026-09-20T00:00:00Z"),
  productName: "样板智能体",
  planName: "入门版",
  status,
});

describe("到点处置：动作按暂停原因分岔", () => {
  let m: SweepMocks;
  beforeEach(() => {
    m = buildSweepMocks(VXTPL);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "suspended" }),
    );
  });

  it("没有超期的 → 不写库，天数只读一次配置", async () => {
    await expect(m.service.sweepOverdueSuspensions()).resolves.toEqual({
      resumed: 0,
      terminated: 0,
    });
    expect(m.repo.getMaxSuspendDays).toHaveBeenCalledTimes(1);
    expect(m.repo.update).not.toHaveBeenCalled();
  });

  it("平台原因 → 强制恢复（active），不是终止", async () => {
    m.repo.findOverdueSuspensions.mockResolvedValue([
      episode({ reason: "platform_ops", extendsTerm: true }),
    ]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await expect(m.service.sweepOverdueSuspensions()).resolves.toEqual({
      resumed: 1,
      terminated: 0,
    });
    expect(m.repo.update.mock.calls[0]?.[2]).toMatchObject({
      status: "active",
      expectedStatus: "suspended",
    });
  });

  it("客户违规 → 终止（cancelled），且不还原续费意愿", async () => {
    m.repo.findOverdueSuspensions.mockResolvedValue([
      episode({
        reason: "customer_violation",
        extendsTerm: false,
        autoRenewBefore: true,
      }),
    ]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "cancelled" }),
    );
    await expect(m.service.sweepOverdueSuspensions()).resolves.toEqual({
      resumed: 0,
      terminated: 1,
    });
    // 终态本来就不续：autoRenew 必须是 false，不能是 episode 里记的 true。
    expect(m.repo.update.mock.calls[0]?.[2]).toMatchObject({
      status: "cancelled",
      autoRenew: false,
    });
  });

  it("恢复时还原暂停那一刻的续费意愿（false 也要还原成 false）", async () => {
    m.repo.findOverdueSuspensions.mockResolvedValue([
      episode({ autoRenewBefore: false }),
    ]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await m.service.sweepOverdueSuspensions();
    expect(m.repo.update.mock.calls[0]?.[2]).toMatchObject({
      autoRenew: false,
    });
  });

  it("存量 episode 没记续费意愿（null）→ 整个键不出现，不动它", async () => {
    m.repo.findOverdueSuspensions.mockResolvedValue([
      episode({ autoRenewBefore: null }),
    ]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await m.service.sweepOverdueSuspensions();
    const input = m.repo.update.mock.calls[0]?.[2] as Record<string, unknown>;
    // 「不动它」= 键不在。传 undefined 在 repo 里碰巧也走到 coalesce 的同一支，但那是
    // 另一个类型（exactOptionalPropertyTypes），而且写法一改就会变成「置 false」。
    expect("autoRenew" in input).toBe(false);
  });

  it("扫到之后状态已经不是 suspended（别的路径动过）→ 跳过，不 clobber", async () => {
    m.repo.findOverdueSuspensions.mockResolvedValue([episode()]);
    m.repo.getById.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    await expect(m.service.sweepOverdueSuspensions()).resolves.toEqual({
      resumed: 0,
      terminated: 0,
    });
    expect(m.repo.update).not.toHaveBeenCalled();
  });

  it("CAS 输了（update 回 null）→ 不闭合 episode、不发信", async () => {
    m.repo.findOverdueSuspensions.mockResolvedValue([episode()]);
    m.repo.update.mockResolvedValue(null);
    await expect(m.service.sweepOverdueSuspensions()).resolves.toEqual({
      resumed: 0,
      terminated: 0,
    });
    expect(m.repo.closeSuspension).not.toHaveBeenCalled();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("先闭合 episode 再结算 —— 顺序反了这一趟捞不到它", async () => {
    const order: string[] = [];
    m.repo.findOverdueSuspensions.mockResolvedValue([episode()]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    m.repo.closeSuspension.mockImplementation(async () => {
      order.push("close");
    });
    m.repo.settleResumedSuspensions.mockImplementation(async () => {
      order.push("settle");
      return [];
    });
    await m.service.sweepOverdueSuspensions();
    expect(order).toEqual(["close", "settle"]);
  });

  it("终止要告诉客户「服务不会再恢复」，不是复用退订那三条", async () => {
    m.repo.findOverdueSuspensions.mockResolvedValue([
      episode({ reason: "customer_violation", extendsTerm: false }),
    ]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "cancelled" }),
    );
    m.repo.getNotifyDisplay.mockResolvedValue(display("cancelled"));
    await m.service.sweepOverdueSuspensions();
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        templateCode: "subscription.suspension_ended",
      }),
    );
  });

  it("强制恢复告诉客户「已恢复」", async () => {
    m.repo.findOverdueSuspensions.mockResolvedValue([episode()]);
    m.repo.update.mockResolvedValue(
      subscriptionFixture({ id: "s-1", status: "active" }),
    );
    m.repo.getNotifyDisplay.mockResolvedValue(display("active"));
    await m.service.sweepOverdueSuspensions();
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ templateCode: "subscription.resumed" }),
    );
  });
});

describe("顺延结算：欠客户的账不能静默丢", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(VXTPL)));

  it("带 subscriptionId 时只结那一条（运营恢复后的即时结算）", async () => {
    m.repo.settleResumedSuspensions.mockResolvedValue([
      {
        id: "sus-1",
        subscriptionId: "s-1",
        grantedSeconds: 864000,
        extended: true,
      },
    ]);
    await expect(m.service.settleSuspensionExtension("s-1")).resolves.toBe(1);
    expect(m.repo.settleResumedSuspensions).toHaveBeenCalledWith({
      subscriptionId: "s-1",
      limit: 100,
    });
  });

  it("不带 subscriptionId 时**整个键不出现**（作业兜底扫全量）", async () => {
    await m.service.settleSuspensionExtension();
    const arg = m.repo.settleResumedSuspensions.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect("subscriptionId" in arg).toBe(false);
    expect(arg).toMatchObject({ limit: 100 });
  });

  it("结算抛异常 → 返回 0 而不是把异常抛给调用方（恢复动作已经生效）", async () => {
    m.repo.settleResumedSuspensions.mockRejectedValue(new Error("db"));
    await expect(m.service.settleSuspensionExtension("s-1")).resolves.toBe(0);
  });

  it("永久订阅（没有 end_at）：秒数记下来但没加上去 —— 要留痕，不静默跳过", async () => {
    const logged: string[] = [];
    const svc = m.service as unknown as {
      logger: { log: (msg: string) => void };
    };
    vi.spyOn(svc.logger, "log").mockImplementation((msg: string) => {
      logged.push(msg);
    });
    m.repo.settleResumedSuspensions.mockResolvedValue([
      {
        id: "sus-1",
        subscriptionId: "s-1",
        grantedSeconds: 86400,
        extended: false,
      },
    ]);
    await expect(m.service.settleSuspensionExtension("s-1")).resolves.toBe(1);
    expect(logged.join("\n")).toContain("no end_at");
  });
});
