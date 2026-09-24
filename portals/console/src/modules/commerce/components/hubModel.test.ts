/**
 * 服务状态轴 —— 「服务还在不在」这个问题只有订阅能回答。
 *
 * ── 这一格为什么要测 ──
 * 2026-09-24 实撞：owner 退订 vxtpl 之后，费用中心里那两张单（含一张**已收款的付费单**）
 * 都还写着「服务中」，而订阅已经彻底没有了。根因是这一列原来只按 `SVC_AXIS[orderStatus]`
 * 派生——订单走到 `completed` 就再也不动，于是它永远停在「服务中」。
 *
 * 类型、构建、lint 都拦不住这种缺陷：它不是类型错，是**一列名义上回答 A、实际读的是 B**。
 * 只有一条断言「订阅取消了这一列就不能还说服务中」能管住它。
 *
 * @package @vxture/console
 * @layer Presentation
 * @category Tests - Commerce
 * @author AI-Generated
 * @date 2026-09-24
 */

import { describe, expect, it } from "vitest";
import { SVC_AXIS, svcAxisFor } from "./hubModel";

describe("svcAxisFor", () => {
  it("订阅已取消 → 不能再说「服务中」（本次事故的正路径）", () => {
    expect(svcAxisFor("completed", "cancelled").key).toBe("terminated");
    /* 和只看订单的老做法对比：老做法在同样输入下说的是 active。 */
    expect(SVC_AXIS.completed.key).toBe("active");
  });

  it("在用族一律「服务中」：active / trialing / expiring / overdue", () => {
    for (const s of ["active", "trialing", "expiring", "overdue"]) {
      expect(svcAxisFor("completed", s).key).toBe("active");
    }
  });

  it("暂停与过期各有各的说法，不混进「已取消」", () => {
    expect(svcAxisFor("completed", "suspended").key).toBe("suspended");
    expect(svcAxisFor("completed", "expired").key).toBe("terminated");
  });

  it("还没有订阅（未履约）→ 回落订单轴，那时能回答的只有订单", () => {
    expect(svcAxisFor("pending_payment", null).key).toBe("notProvisioned");
    expect(svcAxisFor("activating", null).key).toBe("provisioning");
    expect(svcAxisFor("cancelled", null).key).toBe("cancelled");
  });

  it("认不得的订阅状态 → 回落订单轴，而不是画一个空徽标", () => {
    expect(svcAxisFor("completed", "who-knows").key).toBe("active");
  });
});
