/**
 * operator-renew-notify.spec.ts — 运营代客动作的通知，第三档「续期」（2026-09-28 收尾）。
 *
 * 缺口：运营在订阅侧按「续期确认」，客户一句话都收不到；自助续费与自动续费两条路一直在
 * 发（order.service 履约时按 mode === "renew" 发 `subscription.renewed`）。
 *
 * 这一组钉四件事，每一件都是 tsc 看不见的：
 *   1. 续期走的是**另一条模板**（`subscription.renewed_by_operator`），不是自助那条——
 *      自助那条的正文要说实付金额，而代客续期没有订单、没有付款；
 *   2. 冻结 / 恢复两档**没被改**（同一个方法长出第三档，最容易的错是顶掉前两档）；
 *   3. notifier 抛异常不冒出来：隔离就在这一层（`emit` 吞异常只记日志），所以 admin-bff
 *      那条裸 SQL 事务提交之后的这一次调用绝不会把已经生效的续期弄失败；
 *   4. perpetual 周期（endAt 为 NULL）不发：那一次续期没有挪动任何一个日子，
 *      「新周期至 —」不是一句话。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { buildSweepMocks, type SweepMocks } from "./sweep-spec.helpers";

const SUB_ID = "11111111-1111-4111-8111-111111111111";
const UUID_SHAPE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const ARDA = {
  productId: "prod-arda",
  productCode: "arda",
  planCode: "arda-pro",
};

/** getNotifyDisplay 读回的那一行（续期已经落库，所以 endAt 是**续期后**的日子）。 */
const display = (over: Record<string, unknown> = {}) => ({
  id: SUB_ID,
  tenantId: "org-1",
  endAt: new Date("2027-09-10T00:00:00Z"),
  trialEndAt: null,
  productName: "Arda",
  planName: "Pro",
  status: "active",
  ...over,
});

/** 第 i 次 notify 的入参（假替身的入参是 any，这里收成一个有形状的读法）。 */
function sentAt(
  m: SweepMocks,
  i: number,
): { templateCode: string; params: Record<string, unknown> } {
  return m.notifier.notify.mock.calls[i]![0] as {
    templateCode: string;
    params: Record<string, unknown>;
  };
}

describe("notifyOperatorStatusChange —— 代客续期", () => {
  let m: SweepMocks;
  beforeEach(() => (m = buildSweepMocks(ARDA)));

  it("恰好一条 subscription.renewed_by_operator，说的是新的到期日", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(display());

    await m.service.notifyOperatorStatusChange(SUB_ID, "renewed");

    expect(m.notifier.notify).toHaveBeenCalledTimes(1);
    expect(m.notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "org-1",
        templateCode: "subscription.renewed_by_operator",
        /* 去重锚 = 订阅 × **新的**到期日：再续一期日期就变，下一条不会被唯一键吞掉。 */
        reference: { type: "subscription", id: `${SUB_ID}:2027-09-10` },
        params: expect.objectContaining({
          productName: "Arda",
          planName: "Pro",
          endAt: "2027-09-10",
        }),
        link: "/subscription",
      }),
    );
  });

  it("**不带金额参数**：这条路上没有订单也没有付款，没有诚实的值可填", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(display());

    await m.service.notifyOperatorStatusChange(SUB_ID, "renewed");

    const { params } = sentAt(m, 0);
    expect(params.amount).toBeUndefined();
    expect(params.orderNo).toBeUndefined();
    // 客户看得见的那一半不出现 uuid（引用键是去重用的，不上屏）。
    expect(JSON.stringify(params)).not.toMatch(UUID_SHAPE);
  });

  it("perpetual（没有到期日）一条不发 —— 那次续期没挪动任何日子", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(display({ endAt: null }));

    await m.service.notifyOperatorStatusChange(SUB_ID, "renewed");

    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("读不到展示行（并发删了之类）一条不发，也不抛", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(null);

    await expect(
      m.service.notifyOperatorStatusChange(SUB_ID, "renewed"),
    ).resolves.toBeUndefined();

    expect(m.notifier.notify).not.toHaveBeenCalled();
  });

  it("notifier 抛异常：本方法照常返回 —— 调用方那次续期不会因此失败或回滚", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(display());
    m.notifier.notify.mockRejectedValue(new Error("smtp down"));

    await expect(
      m.service.notifyOperatorStatusChange(SUB_ID, "renewed"),
    ).resolves.toBeUndefined();

    expect(m.notifier.notify).toHaveBeenCalledTimes(1);
  });

  it("冻结 / 恢复两档没被顶掉（第三档是新增，不是改写）", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(display());

    await m.service.notifyOperatorStatusChange(SUB_ID, "suspended");
    await m.service.notifyOperatorStatusChange(SUB_ID, "resumed");

    expect(m.notifier.notify).toHaveBeenCalledTimes(2);
    expect(sentAt(m, 0).templateCode).toBe("subscription.suspended");
    expect(sentAt(m, 1).templateCode).toBe("subscription.resumed");
  });

  it("冻结 / 恢复不受「没有到期日」的限制 —— 它们说的是服务在不在", async () => {
    m.repo.getNotifyDisplay.mockResolvedValue(display({ endAt: null }));

    await m.service.notifyOperatorStatusChange(SUB_ID, "suspended");

    expect(m.notifier.notify).toHaveBeenCalledTimes(1);
    expect(sentAt(m, 0).templateCode).toBe("subscription.suspended");
  });
});
