/**
 * suspended-occupies-slot.spec.ts —— 冻结中的订阅仍然占着产品槽位（2026-09-26）。
 *
 * 【现场】owner 上线走查时发现：订阅被暂停期间，官网产品卡片显示的是「订阅」。
 * 那只是露出来的一角——真正的后果在库里实测过：
 *   ① 订阅 → suspended
 *   ② 同 workspace×product 再建一条 active（客户从卡片点「订阅」买第二份）
 *   ③ 运营点「恢复订阅」→ 23505，那条被冻结的订阅从此恢复不了
 *
 * 【判据】「占位」与「在服务」是两个问题，答案在 suspended 这一档上相反：
 *   · 权益（C2 / 用量 / 消费的 active+trialing）：冻结中**不给**服务 —— 对。
 *   · 占位（还能不能再买、恢复后回不回得到原地）：冻结中**仍然占着** —— 此前答错。
 * 一个集合被两个问题共用，就会在某一档上同时对一个、错一个。这一层只钉占位那一个。
 *
 * 另一半同样要钉：**原因不出网**。值域里有 `customer_violation`，那是运营的判断；
 * 但也不能一律说成「维护中」，那是平台替自己撒谎。所以映射成一组客户看得懂、且都为真
 * 的展示态。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { Request } from "express";
import { ProductSubscriptionsRouter } from "./product-subscriptions.router";
import type { RequestContext } from "../types/auth.types";

const TENANT = "11111111-1111-4111-8111-111111111111";

type Row = {
  product_code: string;
  status: string;
  tier: string | null;
  home_url: string | null;
  can_upgrade: boolean;
  suspension_reason: string | null;
  suspended_since: Date | null;
  suspension_extends_term: boolean | null;
};

const row = (over: Partial<Row> = {}): Row => ({
  product_code: "vxtpl",
  status: "active",
  tier: "free",
  home_url: null,
  can_upgrade: true,
  suspension_reason: null,
  suspended_since: null,
  suspension_extends_term: null,
  ...over,
});

function makeRouter(rows: Row[]) {
  const query = vi.fn(async () => ({ rows }));
  const router = new ProductSubscriptionsRouter({ query } as unknown as Pool);
  const req = { tenantId: TENANT } as unknown as Request & RequestContext;
  return { router, req, query };
}

describe("冻结中的订阅仍算「已订阅」", () => {
  it("suspended → subscribed=true（否则卡片落到「订阅」分支，客户会买第二份）", async () => {
    const { router, req } = makeRouter([
      row({ status: "suspended", suspension_reason: "platform_ops" }),
    ]);
    const [out] = await router.getProductSubscriptions(req);
    expect(out?.subscribed).toBe(true);
  });

  it("冻结中不给升级 —— 换档会改动那条被平台冻结的订阅", async () => {
    const { router, req } = makeRouter([
      row({
        status: "suspended",
        suspension_reason: "platform_ops",
        can_upgrade: true,
      }),
    ]);
    const [out] = await router.getProductSubscriptions(req);
    expect(out?.canUpgrade).toBe(false);
  });

  it("在用时 canUpgrade 仍按可售档位给（没把这条一起关掉）", async () => {
    const { router, req } = makeRouter([row({ can_upgrade: true })]);
    const [out] = await router.getProductSubscriptions(req);
    expect(out?.canUpgrade).toBe(true);
  });

  it("已到期 / 已取消仍是「没有订阅」—— 占位只认还在的那些", async () => {
    for (const status of ["expired", "cancelled"]) {
      const { router, req } = makeRouter([row({ status })]);
      const [out] = await router.getProductSubscriptions(req);
      expect(out?.subscribed, status).toBe(false);
    }
  });
});

describe("原因不出网，但要说得对", () => {
  const cases: [string, string][] = [
    ["platform_ops", "maintenance"],
    ["dispute_review", "review"],
    ["customer_violation", "restricted"],
    ["other", "paused"],
  ];

  for (const [reason, state] of cases) {
    it(`${reason} → ${state}`, async () => {
      const { router, req } = makeRouter([
        row({ status: "suspended", suspension_reason: reason }),
      ]);
      const [out] = await router.getProductSubscriptions(req);
      expect(out?.suspensionState).toBe(state);
      // 原因本身一个字都不该出现在回包里。
      expect(JSON.stringify(out)).not.toContain(reason);
    });
  }

  it("存量冻结行没有 episode → 落到最中性的 paused，不猜一个更好听的", async () => {
    const { router, req } = makeRouter([
      row({ status: "suspended", suspension_reason: null }),
    ]);
    const [out] = await router.getProductSubscriptions(req);
    expect(out?.suspensionState).toBe("paused");
    expect(out?.suspensionExtendsTerm).toBeNull();
  });

  it("未冻结时三个字段都是 null（不给界面留一个假状态）", async () => {
    const { router, req } = makeRouter([row()]);
    const [out] = await router.getProductSubscriptions(req);
    expect(out?.suspensionState).toBeNull();
    expect(out?.suspendedSince).toBeNull();
    expect(out?.suspensionExtendsTerm).toBeNull();
  });

  it("顺延与否照实回传 —— 客户真正关心的是这些天还不还给他", async () => {
    const { router, req } = makeRouter([
      row({
        status: "suspended",
        suspension_reason: "customer_violation",
        suspension_extends_term: false,
        suspended_since: new Date("2026-09-26T00:00:00Z"),
      }),
    ]);
    const [out] = await router.getProductSubscriptions(req);
    expect(out?.suspensionExtendsTerm).toBe(false);
    expect(out?.suspendedSince).toBe("2026-09-26T00:00:00.000Z");
  });
});

describe("未登录", () => {
  it("没有 tenantId → 空数组，且一次都不碰库", async () => {
    const { router, query } = makeRouter([]);
    const req = {} as unknown as Request & RequestContext;
    await expect(router.getProductSubscriptions(req)).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
