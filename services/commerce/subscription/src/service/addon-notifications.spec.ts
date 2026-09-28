/**
 * addon-notifications.spec.ts —— 加油包四条客户通知的**纪律**（2026-09-28 批 5）。
 *
 * 判据（哪一行算哪一档）在 addon-lifecycle.spec；这一组钉的是通知与业务的关系：
 *   · 一次真的转移发一封，重驱动（CAS 说「已经结算过了」）一封都不发；
 *   · 通知炸了不许影响业务结果——核销已经提交了，发不出去只记日志；
 *   · 没注入 notifier 的服务与改动之前**逐字**一样（连展示数据都不查）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddonService } from "./addon.service";
import type { PgAddonRepository } from "../repository/pg-addon.repository";
import type { AddonPoolCandidate } from "../types/addon.types";

const NOW_MS = Date.now();
const DAY = 86_400_000;

const settled = {
  id: "33333333-3333-4333-8333-333333333333",
  orderNo: "ORD-202609-1A2B3C4D5E",
  packCode: "addon-credits-100",
  metricKey: "ai.credit",
  amount: "100",
  quotaPoolId: "44444444-4444-4444-8444-444444444444",
  workspaceId: "ws-1",
};

const display = {
  orderNo: settled.orderNo,
  tenantId: "org-1",
  packName: "AI 加油包 100 Credits",
  price: "29.90",
  currency: "CNY",
  expiresAt: new Date(NOW_MS + 365 * DAY),
  createdByType: "customer",
  createdById: "22222222-2222-4222-8222-222222222222",
};

const candidate = (over: Partial<AddonPoolCandidate> = {}) =>
  ({
    ...display,
    metricKind: "counter",
    resetPeriod: "none",
    quotaLimit: "100",
    quotaUsed: "10",
    expiresAt: new Date(NOW_MS + 30 * DAY),
    poolUpdatedAt: new Date(NOW_MS),
    ...over,
  }) as AddonPoolCandidate;

const build = () => {
  const repo = {
    confirmPayment: vi.fn().mockResolvedValue(settled),
    getNotifyDisplay: vi.fn().mockResolvedValue(display),
    findLifecycleCandidates: vi.fn().mockResolvedValue([]),
  };
  const notifier = { notify: vi.fn(async () => undefined) };
  const service = new AddonService(repo as unknown as PgAddonRepository);
  return { repo, notifier, service };
};

describe("confirmPayment —— 开通通知", () => {
  let m: ReturnType<typeof build>;
  beforeEach(() => (m = build()));

  it("一次真的核销 → 一封 addon.activated，可视码上屏", async () => {
    m.service.setCustomerNotifier(m.notifier);
    await m.service.confirmPayment({
      purchaseId: settled.id,
      operatorId: "op",
    });
    expect(m.notifier.notify).toHaveBeenCalledTimes(1);
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        templateCode: "addon.activated",
        reference: { type: "addon", id: settled.orderNo },
      }),
    );
    expect(m.repo.getNotifyDisplay).toHaveBeenCalledWith(settled.id);
  });

  it("重驱动（已结算，CAS 让 repo 回 null）一封都不发", async () => {
    m.service.setCustomerNotifier(m.notifier);
    m.repo.confirmPayment.mockResolvedValueOnce(null);
    await expect(
      m.service.confirmPayment({ purchaseId: settled.id, operatorId: "op" }),
    ).resolves.toBeNull();
    expect(m.notifier.notify).not.toHaveBeenCalled();
    expect(m.repo.getNotifyDisplay).not.toHaveBeenCalled();
  });

  it("notifier 抛异常：核销结果照旧返回，不抛不回滚", async () => {
    m.service.setCustomerNotifier(m.notifier);
    m.notifier.notify.mockRejectedValue(new Error("smtp down"));
    await expect(
      m.service.confirmPayment({ purchaseId: settled.id, operatorId: "op" }),
    ).resolves.toMatchObject({ orderNo: settled.orderNo });
  });

  it("展示数据取不到就不发，核销结果不受影响", async () => {
    m.service.setCustomerNotifier(m.notifier);
    m.repo.getNotifyDisplay.mockResolvedValueOnce(null);
    await expect(
      m.service.confirmPayment({ purchaseId: settled.id, operatorId: "op" }),
    ).resolves.toMatchObject({ orderNo: settled.orderNo });
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("没注入 notifier 的服务行为与此前逐字一样：连展示数据都不查", async () => {
    await expect(
      m.service.confirmPayment({ purchaseId: settled.id, operatorId: "op" }),
    ).resolves.toMatchObject({ orderNo: settled.orderNo });
    expect(m.repo.getNotifyDisplay).not.toHaveBeenCalled();
  });

  it("核销本身失败：抛出去（映射后的异常），一封都不发", async () => {
    m.service.setCustomerNotifier(m.notifier);
    m.repo.confirmPayment.mockRejectedValueOnce(
      new Error("addon_order_not_pending"),
    );
    await expect(
      m.service.confirmPayment({ purchaseId: settled.id, operatorId: "op" }),
    ).rejects.toThrow();
    expect(m.notifier.notify).not.toHaveBeenCalled();
  });
});

describe("sweepAddonLifecycle", () => {
  let m: ReturnType<typeof build>;
  beforeEach(() => (m = build()));

  it("没注入 notifier：零条、且连候选都不查（这一趟除了发通知不做别的事）", async () => {
    await expect(
      m.service.sweepAddonLifecycle({ leadDays: 7, backlogDays: 3 }),
    ).resolves.toEqual({
      expiringSoon: 0,
      exhausted: 0,
      expired: 0,
      saturated: false,
    });
    expect(m.repo.findLifecycleCandidates).not.toHaveBeenCalled();
  });

  it("三档各计一次；判不出档的行一条都不发", async () => {
    m.service.setCustomerNotifier(m.notifier);
    m.repo.findLifecycleCandidates.mockResolvedValue([
      candidate({ orderNo: "ORD-1", expiresAt: new Date(NOW_MS + 3 * DAY) }),
      candidate({ orderNo: "ORD-2", quotaUsed: "100" }),
      candidate({ orderNo: "ORD-3", expiresAt: new Date(NOW_MS - DAY) }),
      // 存量：过期太久，闸门拦下
      candidate({ orderNo: "ORD-4", expiresAt: new Date(NOW_MS - 30 * DAY) }),
      // gauge 水位到顶：不算用尽，到期日也还早 ⇒ 什么都不发
      candidate({
        orderNo: "ORD-5",
        metricKind: "gauge",
        quotaUsed: "100",
        quotaLimit: "100",
      }),
    ]);
    await expect(
      m.service.sweepAddonLifecycle({ leadDays: 7, backlogDays: 3 }),
    ).resolves.toEqual({
      expiringSoon: 1,
      exhausted: 1,
      expired: 1,
      saturated: false,
    });
    expect(m.notifier.notify).toHaveBeenCalledTimes(3);
    const codes = m.notifier.notify.mock.calls.map(
      (c) => (c as unknown as [{ templateCode: string }])[0].templateCode,
    );
    expect(codes).toEqual([
      "addon.expiring_soon",
      "addon.exhausted",
      "addon.expired",
    ]);
  });

  it("一行发不出去不中断本趟，且那一行不计数", async () => {
    m.service.setCustomerNotifier(m.notifier);
    m.repo.findLifecycleCandidates.mockResolvedValue([
      candidate({ orderNo: "ORD-bad", quotaUsed: "100" }),
      candidate({ orderNo: "ORD-good", quotaUsed: "100" }),
    ]);
    m.notifier.notify
      .mockRejectedValueOnce(new Error("smtp down"))
      .mockResolvedValueOnce(undefined);
    await expect(
      m.service.sweepAddonLifecycle({ leadDays: 7, backlogDays: 3 }),
    ).resolves.toEqual({
      expiringSoon: 0,
      exhausted: 1,
      expired: 0,
      saturated: false,
    });
    expect(m.notifier.notify).toHaveBeenCalledTimes(2);
  });

  it("窗口参数原样传给候选查询（含 limit；不传 limit 时整个键不出现）", async () => {
    m.service.setCustomerNotifier(m.notifier);
    await m.service.sweepAddonLifecycle({
      leadDays: 14,
      backlogDays: 2,
      limit: 50,
    });
    expect(m.repo.findLifecycleCandidates).toHaveBeenCalledWith({
      leadDays: 14,
      backlogDays: 2,
      limit: 50,
    });
    await m.service.sweepAddonLifecycle({ leadDays: 14, backlogDays: 2 });
    expect(m.repo.findLifecycleCandidates).toHaveBeenLastCalledWith({
      leadDays: 14,
      backlogDays: 2,
    });
  });

  /*
   * 取数到上限要出声。查询没有游标，所以真的满了的一趟会反复重扫头部而尾巴
   * 永远转不到，而它不报错、只是静默少发——条数上看起来与繁忙的一趟一模一样。
   */
  it("取数到上限：saturated 为真（条数看不出来，得有一位专门说这事）", async () => {
    m.service.setCustomerNotifier(m.notifier);
    m.repo.findLifecycleCandidates.mockResolvedValue([
      candidate({ orderNo: "ORD-cap", quotaUsed: "100" }),
    ]);
    await expect(
      m.service.sweepAddonLifecycle({ leadDays: 7, backlogDays: 3, limit: 1 }),
    ).resolves.toEqual({
      expiringSoon: 0,
      exhausted: 1,
      expired: 0,
      saturated: true,
    });
  });

  it("没给 limit 时，满的判据用的默认值要与仓储那侧同值", async () => {
    m.service.setCustomerNotifier(m.notifier);
    /* 仓储默认 200。这里给 199 行（未满）与 200 行（满）各一趟：
       两处各写一个数字时，这条会当场红。 */
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        candidate({ orderNo: `ORD-${i}`, quotaUsed: "100" }),
      );
    m.repo.findLifecycleCandidates.mockResolvedValueOnce(rows(199));
    await expect(
      m.service.sweepAddonLifecycle({ leadDays: 7, backlogDays: 3 }),
    ).resolves.toMatchObject({ saturated: false });
    m.repo.findLifecycleCandidates.mockResolvedValueOnce(rows(200));
    await expect(
      m.service.sweepAddonLifecycle({ leadDays: 7, backlogDays: 3 }),
    ).resolves.toMatchObject({ saturated: true });
  });
});
