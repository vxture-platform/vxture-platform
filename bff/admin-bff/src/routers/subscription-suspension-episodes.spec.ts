import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import type {
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import { SubscriptionsRouter } from "./subscriptions.router";
import type { RequestContext } from "../types/console.types";

/*
 * 暂停原因轴（owner 2026-09-25）——这条线要钉的不是「表建出来了」，而是三件会悄悄错的事：
 *
 *   ① 暂停必须带原因，且不给默认值。默认成「平台运维」会让**顺延悄悄发生**在一次本该
 *      不顺延的违规暂停上，而运营根本没被问过。这类错不报错、只在到期日上差出几十天。
 *   ② episode 的开合按**状态转移**判，不按动作名。离开 suspended 的路不止 resume 一条：
 *      renew 会把冻结行翻回 active，cancel 会把它带进终态。只认 resume 就是给另外两条
 *      留门（[[feedback-guard-on-one-branch-only]]），那条 episode 会永远挂着，
 *      而步骤三的到点处置正是按未闭合 episode 扫的。
 *   ③ extends_term 由原因派生，**只有客户违规不顺延**——公道的那一侧是默认值不是例外。
 *
 * 判据落在「发给库的那条 SQL 带了什么参数」上：这一层的行为就是写库，断言 mock 之外的
 * 任何东西（比如返回值）都只能验到装配，验不到写了什么。
 */

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const SUB_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const PLAN_VERSION_ID = "44444444-4444-4444-8444-444444444444";

function makeReq(): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities: ["commerce:subscription.manage"],
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

/** 事务池：记下每条 SQL 与它的参数，锁行查询回一条可控的订阅。 */
function makeRwPool(status: string) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    calls.push({ sql: text, params: params ?? [] });
    if (/for update of s/i.test(text)) {
      return {
        rows: [
          {
            id: SUB_ID,
            tenant_id: TENANT_ID,
            status,
            auto_renew: true,
            cycle_unit: "month",
            cycle_count: 1,
            end_at: new Date(Date.now() + 30 * 86400_000),
            subscription_kind: "paid",
            plan_version_id: PLAN_VERSION_ID,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(),
  } as unknown as Pool;
  const find = (needle: RegExp) =>
    calls.find((c) => needle.test(c.sql.toLowerCase()));
  return { pool, calls, find };
}

/** 只读池：详情读回。`limit 1` 的那条暂停查询回空即可（本线不验渲染）。 */
function makeRoPool() {
  const query = vi.fn(async () => ({ rows: [] as unknown[] }));
  return { query } as unknown as Pool;
}

function makeRouter(status: string) {
  const rw = makeRwPool(status);
  const subscriptions = {
    applyExternalStatusChange: vi.fn(async () => undefined),
    notifyOperatorStatusChange: vi.fn(async () => undefined),
  } as unknown as SubscriptionService;
  const orders = {
    settleAfterCancel: vi.fn(async () => undefined),
  } as unknown as OrderService;
  const router = new SubscriptionsRouter(
    makeRoPool(),
    rw.pool,
    subscriptions,
    orders,
  );
  return { router, rw };
}

/** 详情读回会 404（只读池回空行）——本线只看事务里写了什么，到这一步已经写完了。 */
async function run(
  router: SubscriptionsRouter,
  body: Record<string, unknown>,
): Promise<unknown> {
  return router
    .runSubscriptionAction(makeReq(), SUB_ID, body)
    .catch((e: unknown) => e);
}

describe("暂停必须带原因（不给默认值）", () => {
  it("不带 suspendReason 的 suspend → 400，且一次都没碰库", async () => {
    const { router, rw } = makeRouter("active");
    const err = await run(router, { action: "suspend", reason: "复核" });
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(/suspendReason/);
    expect(rw.pool.connect).not.toHaveBeenCalled();
  });

  it("值域外的原因同样被拒 —— 拼错一个字不该静默变成「顺延」", async () => {
    const { router } = makeRouter("active");
    const err = await run(router, {
      action: "suspend",
      reason: "复核",
      suspendReason: "platform-ops",
    });
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it("其余动作不要求原因：resume 不带它也能走到写库", async () => {
    const { router, rw } = makeRouter("suspended");
    await run(router, { action: "resume", reason: "复核完成" });
    expect(rw.find(/update metering\.subscriptions/)).toBeDefined();
  });
});

describe("extends_term 由原因派生：只有客户违规不顺延", () => {
  const cases: [string, boolean][] = [
    ["platform_ops", true],
    ["dispute_review", true],
    ["customer_violation", false],
    ["other", true],
  ];

  for (const [reason, extendsTerm] of cases) {
    it(`${reason} → extends_term=${extendsTerm}`, async () => {
      const { router, rw } = makeRouter("active");
      await run(router, {
        action: "suspend",
        reason: "运营复核",
        suspendReason: reason,
      });
      const open = rw.find(/insert into metering\.subscription_suspensions/);
      expect(open).toBeDefined();
      // $1 sub / $2 tenant / $3 reason / $4 note / $5 extends_term
      expect(open?.params[2]).toBe(reason);
      expect(open?.params[4]).toBe(extendsTerm);
      expect(open?.params[1]).toBe(TENANT_ID);
    });
  }
});

describe("episode 的开合按状态转移，不按动作名", () => {
  it("active → suspended：开一条，不闭合任何东西", async () => {
    const { router, rw } = makeRouter("active");
    await run(router, {
      action: "suspend",
      reason: "平台迁移",
      suspendReason: "platform_ops",
    });
    expect(
      rw.find(/insert into metering\.subscription_suspensions/),
    ).toBeDefined();
    expect(
      rw.find(/update metering\.subscription_suspensions/),
    ).toBeUndefined();
  });

  it("suspended → active（resume）：闭合那一条", async () => {
    const { router, rw } = makeRouter("suspended");
    await run(router, { action: "resume", reason: "复核完成" });
    const close = rw.find(/update metering\.subscription_suspensions/);
    expect(close).toBeDefined();
    expect(close?.sql.toLowerCase()).toContain("resumed_at is null");
    expect(close?.params[0]).toBe(SUB_ID);
  });

  it("suspended → active（renew）：也要闭合 —— 续期是离开 suspended 的第二条路", async () => {
    const { router, rw } = makeRouter("suspended");
    await run(router, { action: "renew", reason: "合同已续签" });
    expect(rw.find(/update metering\.subscription_suspensions/)).toBeDefined();
  });

  it("suspended → cancelled：也要闭合 —— 否则终态订阅永远挂着一次未闭合的暂停", async () => {
    const { router, rw } = makeRouter("suspended");
    await run(router, { action: "cancel", reason: "客户不再续约" });
    expect(rw.find(/update metering\.subscription_suspensions/)).toBeDefined();
  });

  it("active → cancelled：既不开也不闭合", async () => {
    const { router, rw } = makeRouter("active");
    await run(router, { action: "cancel", reason: "客户不再续约" });
    expect(rw.find(/metering\.subscription_suspensions/)).toBeUndefined();
  });
});
