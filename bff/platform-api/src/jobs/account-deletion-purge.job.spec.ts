/**
 * account-deletion-purge.job.spec.ts — 清扫顺序：CAS 当门（2026-10-03）。
 *
 * 这个作业原来没有 spec。加它是因为 A2 第五轮在这里找到一条缺陷，而那条缺陷
 * **只在顺序里**，不在任何一条 SQL 里：
 *
 *   候选集按 `status = 'deleting'` 选，而 `softDeletePersonalOrg` 那条 UPDATE
 *   不带「此刻仍在删除中」的条件；保留期内又允许登录与撤销删除。于是撤销插在
 *   取数与落笔之间时，账号留在 active 而个人租户被软删。
 *
 * 所以这里测的全是**调用顺序与条件**，不是 SQL —— 用桩正好，连库都不用起。
 * 心跳桩只为满足构造参数（同 invitation-expiry.job.spec）。
 */
import { describe, expect, it, vi } from "vitest";
import { AccountDeletionPurgeJob } from "./account-deletion-purge.job";
import type { AccountService } from "@vxture/service-account";
import type { OrganizationService } from "@vxture/service-organization";
import type { JobHeartbeatService } from "./job-heartbeat.service";

const heartbeat = () =>
  ({
    recordStart: vi.fn().mockResolvedValue(undefined),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  }) as unknown as JobHeartbeatService;

/** `purgeUser` 按 uid 回 true/false；记录调用次序供断言。 */
function harness(opts: {
  due: string[];
  purgeOk: (uid: string) => boolean;
  softDeleteThrows?: boolean;
}) {
  const order: string[] = [];
  const account = {
    listDeletionDue: vi.fn().mockResolvedValue(opts.due),
    purgeUser: vi.fn(async (uid: string) => {
      order.push(`purge:${uid}`);
      return opts.purgeOk(uid);
    }),
  } as unknown as AccountService;
  const org = {
    softDeletePersonalOrg: vi.fn(async (uid: string) => {
      order.push(`softDelete:${uid}`);
      if (opts.softDeleteThrows) throw new Error("boom");
      return true;
    }),
  } as unknown as OrganizationService;
  const job = new AccountDeletionPurgeJob(account, org, heartbeat());
  return { job, account, org, order };
}

describe("账号删除清扫：顺序", () => {
  /**
   * 这一条就是那个缺陷的反例。改回「先软删租户」它必然红：
   * softDelete 会在 purge 之前被调用，而且对撤销过的那个人也会被调用。
   */
  it("CAS 先行：撤销过的人个人租户一个字都不动", async () => {
    const { job, org, order } = harness({
      due: ["u-cancelled", "u-still-deleting"],
      // 取数之后 u-cancelled 撤销了删除 ⇒ CAS 改零行 ⇒ false
      purgeOk: (uid) => uid !== "u-cancelled",
    });

    expect(await job.pass()).toBe(1);

    // 撤销那个人的租户没被碰过 —— 这是缺陷的核心后果
    expect(org.softDeletePersonalOrg).not.toHaveBeenCalledWith("u-cancelled");
    expect(org.softDeletePersonalOrg).toHaveBeenCalledTimes(1);
    expect(org.softDeletePersonalOrg).toHaveBeenCalledWith("u-still-deleting");

    // 每个人都是先 purge 再 softDelete，不是反过来
    expect(order).toEqual([
      "purge:u-cancelled",
      "purge:u-still-deleting",
      "softDelete:u-still-deleting",
    ]);
  });

  it("租户软删失败不吞：账号已清理，留下孤儿租户要记 error", async () => {
    const errors: string[] = [];
    const { job } = harness({
      due: ["u-1"],
      purgeOk: () => true,
      softDeleteThrows: true,
    });
    // Logger 是实例私有字段，这里用 spy 截 error（与 job-health-alert.job.spec 同法）
    const spy = vi
      .spyOn(
        (job as unknown as { logger: { error: (m: string) => void } }).logger,
        "error",
      )
      .mockImplementation((m: string) => {
        errors.push(m);
      });

    // 软删失败不该让整趟炸掉：这个人的账号已经清理完了，趟要继续
    expect(await job.pass()).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("孤儿租户");
    expect(errors[0]).toContain("u-1");
    spy.mockRestore();
  });

  it("全被撤销时回 0，并且不碰任何租户", async () => {
    const { job, org } = harness({
      due: ["a", "b"],
      purgeOk: () => false,
    });
    expect(await job.pass()).toBe(0);
    expect(org.softDeletePersonalOrg).not.toHaveBeenCalled();
  });
});
