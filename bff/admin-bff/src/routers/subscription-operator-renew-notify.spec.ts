/**
 * subscription-operator-renew-notify.spec.ts — 运营代客续期要告诉客户（2026-09-28 收尾）。
 * @package @vxture/bff-admin
 *
 * 缺口的形状是「守卫只长在一条分支」：`notify` 这个变量的类型此前只有
 * `"suspended" | "resumed"`，赋值也只发生在那两条分支上，于是 renew 一路静默——而客户
 * 自助续费与自动续费两条路（order.service 履约）一直在发。
 *
 * 这一组钉的是**路由的判据**，不是文案：
 *   1. renew 发**一条**通知，动作码是 "renewed"（不是 "resumed"，也不是发两条）；
 *   2. 判据是**动作**而不是状态转移 —— 续期把状态置回 active，而绝大多数续期本来就在
 *      active 上做，`fromStatus !== toStatus` 恒假。按状态判的话这一档永远发不出去；
 *   3. 通知在 **commit 之后**才发：所以它不可能回滚一次已经生效的续期（发不出去那一半
 *      的隔离在服务层，见 @vxture/service-subscription 的 operator-renew-notify.spec）；
 *   4. suspend / resume / cancel 三档行为不变 —— 尤其 cancel：它的客户消息由
 *      `settleAfterCancel`（三态退订模板）发，这里**一条都不该发**，否则同一件事两条。
 */
import { describe, it, expect, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import type {
  OrderService,
  SubscriptionService,
} from "@vxture/service-subscription";
import { SubscriptionsRouter } from "./subscriptions.router";
import type { RequestContext } from "../types/console.types";

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

interface HarnessOptions {
  /** 锁行时读到的状态（续期的常态是 active —— 状态什么都没变）。 */
  status?: string;
  /** 周期单位；perpetual 那一档的「有没有新到期日」由服务层判，不在本层。 */
  cycleUnit?: string;
}

function harness(options: HarnessOptions = {}) {
  const status = options.status ?? "active";
  /** 事务里已经跑过的语句；notify 被调用的那一刻抄一份，用来证明「发在 commit 之后」。 */
  const txCalls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    const text = String(sql).trim().toLowerCase();
    txCalls.push(text);
    if (/for update of s/.test(text)) {
      return {
        rows: [
          {
            id: SUB_ID,
            tenant_id: TENANT_ID,
            status,
            auto_renew: true,
            cycle_unit: options.cycleUnit ?? "month",
            cycle_count: 1,
            end_at: new Date(Date.now() + 30 * 86400_000),
            effective_end_at: new Date(Date.now() + 30 * 86400_000),
            subscription_kind: "paid",
            plan_version_id: PLAN_VERSION_ID,
          },
        ],
      };
    }
    if (/update metering\.subscription_suspensions/.test(text)) {
      return { rows: [{ extends_term: true, auto_renew_before: true }] };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const rwPool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;

  const txCallsWhenNotified: string[][] = [];
  const notifyOperatorStatusChange = vi.fn(async () => {
    txCallsWhenNotified.push([...txCalls]);
  });
  const settleAfterCancel = vi.fn(async () => undefined);
  const subscriptions = {
    applyExternalStatusChange: vi.fn(async () => undefined),
    notifyOperatorStatusChange,
    settleSuspensionExtension: vi.fn(async () => 0),
    reanchorAfterPeriodRestart: vi.fn(async () => 0),
  } as unknown as SubscriptionService;
  const orders = { settleAfterCancel } as unknown as OrderService;

  const router = new SubscriptionsRouter(
    // 只读池回空行 ⇒ 详情读回 404；本线只看事务与提交之后那几次调用。
    {
      query: vi.fn(async () => ({ rows: [] as unknown[] })),
    } as unknown as Pool,
    rwPool,
    subscriptions,
    orders,
  );

  return {
    router,
    notify: notifyOperatorStatusChange,
    settleAfterCancel,
    txCalls,
    txCallsWhenNotified,
  };
}

/** 详情读回会 404（只读池回空行）——到那一步该发的已经发完了。 */
async function run(
  h: ReturnType<typeof harness>,
  body: Record<string, unknown>,
): Promise<unknown> {
  return h.router
    .runSubscriptionAction(makeReq(), SUB_ID, body)
    .catch((e: unknown) => e);
}

describe("运营代客续期 → 客户通知", () => {
  it("续期发恰好一条，动作码是 renewed", async () => {
    const h = harness();

    await run(h, { action: "renew", reason: "合同已续签" });

    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(SUB_ID, "renewed");
  });

  it("状态一点没变也要发 —— 判据是动作，不是状态转移", async () => {
    // active 上续期：fromStatus === toStatus === "active"。此前这一档就是因为挂在
    // `fromStatus !== toStatus` 上而永远发不出去，而真正变了的是服务期。
    const h = harness({ status: "active" });

    await run(h, { action: "renew" });

    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(SUB_ID, "renewed");
  });

  it("冻结中续期发的是 renewed，不是 resumed（别把两件事混成一件）", async () => {
    const h = harness({ status: "suspended" });

    await run(h, { action: "renew", reason: "合同已续签" });

    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(SUB_ID, "renewed");
  });

  it("通知发在 commit 之后 —— 它不可能回滚一次已经生效的续期", async () => {
    const h = harness();

    await run(h, { action: "renew" });

    expect(h.txCallsWhenNotified).toHaveLength(1);
    expect(h.txCallsWhenNotified[0]).toContain("commit");
    expect(h.txCallsWhenNotified[0]).not.toContain("rollback");
  });

  it("事务回滚 → 一条不发（续期没发生，就没有可通知的事）", async () => {
    const h = harness({ status: "cancelled" }); // 终态续期 → 409，事务回滚

    const err = await run(h, { action: "renew" });

    expect(err).toBeInstanceOf(Error);
    expect(h.txCalls).toContain("rollback");
    expect(h.txCalls).not.toContain("commit");
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("suspend / resume 两档没变", async () => {
    const s = harness({ status: "active" });
    await run(s, {
      action: "suspend",
      reason: "平台迁移",
      suspendReason: "platform_ops",
    });
    expect(s.notify).toHaveBeenCalledTimes(1);
    expect(s.notify).toHaveBeenCalledWith(SUB_ID, "suspended");

    const r = harness({ status: "suspended" });
    await run(r, { action: "resume", reason: "复核完成" });
    expect(r.notify).toHaveBeenCalledTimes(1);
    expect(r.notify).toHaveBeenCalledWith(SUB_ID, "resumed");
  });

  it("退订仍然只走结算：这里一条不发，三态退订模板由订单服务发", async () => {
    // 同一件事两个写者就会发两条：退订的客户消息按**退款结果**分三条，那是
    // settleAfterCancel 的职责（它还要决定发给谁）。这一层再发一条就是重复。
    const h = harness({ status: "active" });

    await run(h, { action: "cancel", reason: "客户不再续约" });

    expect(h.notify).not.toHaveBeenCalled();
    expect(h.settleAfterCancel).toHaveBeenCalledTimes(1);
    expect(h.settleAfterCancel).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: SUB_ID,
        tenantId: TENANT_ID,
        actorType: "operator",
      }),
    );
  });
});
