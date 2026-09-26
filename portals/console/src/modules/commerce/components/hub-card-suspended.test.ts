/**
 * hub-card-suspended.test.ts —— 订阅总览卡在冻结中要关掉哪些入口（2026-09-26 走查补）。
 *
 * 走查时抓到的：订阅被暂停，卡片上的状态字是对的（红色「已暂停」），但「升级」还亮着。
 * 点进去会被下单端的守卫和库级唯一索引挡住——客户多走一步再吃闭门羹。
 *
 * 更隐蔽的是**自动续费开关**：客户在暂停期间把它打开，恢复时平台会用 `auto_renew_before`
 * 把它悄悄改回暂停前的值。让人按一个注定被覆盖的开关，比不给还糟，而且两边都不报错。
 *
 * 退订**不关**：客户随时有权离开，退订也不会造出第二条订阅。
 *
 * 这里测的是那几个布尔的算法本身——把它们从组件里抽出来单独判，比渲染整张卡再去数按钮
 * 更能说明「为什么是这几个」。
 */
import { describe, expect, it } from "vitest";
import { hubCardEntries } from "./hubCards.logic";

const base = {
  status: "active",
  tier: "free" as string | null,
  endAt: "2026-10-27T00:00:00Z",
  nearExpiry: false,
};

describe("在用时：三个入口都在", () => {
  it("free 档给升级；有周期就能调自动续费", () => {
    const e = hubCardEntries(base);
    expect(e.showUpgrade).toBe(true);
    expect(e.renewToggleable).toBe(true);
  });

  it("临近到期给续费", () => {
    expect(hubCardEntries({ ...base, nearExpiry: true }).showRenew).toBe(true);
  });
});

describe("冻结中：三个入口都关，退订不受影响", () => {
  const suspended = { ...base, status: "suspended" };

  it("不给升级 —— 它会走到下单，而下单端拦着", () => {
    expect(hubCardEntries(suspended).showUpgrade).toBe(false);
  });

  it("临近到期也不给续费", () => {
    expect(hubCardEntries({ ...suspended, nearExpiry: true }).showRenew).toBe(
      false,
    );
  });

  it("自动续费开关关掉 —— 按了也会被恢复时的还原覆盖", () => {
    expect(hubCardEntries(suspended).renewToggleable).toBe(false);
  });
});

describe("已到期：原有行为不变（这次改动不该碰它）", () => {
  const expired = { ...base, status: "expired" };

  it("不给升级，但给续费", () => {
    const e = hubCardEntries(expired);
    expect(e.showUpgrade).toBe(false);
    expect(e.showRenew).toBe(true);
  });

  it("自动续费开关也关着", () => {
    expect(hubCardEntries(expired).renewToggleable).toBe(false);
  });
});

describe("档位与周期的既有判据没被改坏", () => {
  it("pro 档不给升级（只有 free / starter 给）", () => {
    expect(hubCardEntries({ ...base, tier: "pro" }).showUpgrade).toBe(false);
  });

  it("永久订阅（endAt 为 null）不给调自动续费", () => {
    expect(hubCardEntries({ ...base, endAt: null }).renewToggleable).toBe(
      false,
    );
  });
});
