/**
 * lifecycle.test.ts —— 「加一档状态」与「这一档进得去出得来」是两半（2026-09-27）。
 *
 * 2026-09-24 接 `developing` 时，PRODUCT_ACTIONS 的 launch.from 与 BFF 的 STATE_TRANSITIONS
 * 都放行了它，但 LaunchDrawer 的页脚仍写死 `state === "draft"`——13 个开发中的产品在界面上
 * 只看得到「只做复验」。渲染条件现在收成 `canLaunchFrom`，这份 spec 钉住它与动作表同源：
 * 故意把 launch.from 里的 developing 删掉，第一条会红；故意把 LaunchDrawer 改回写死 draft，
 * 这里不会红——所以渲染处只许调这个函数，别再写状态名（lint 拦不住，靠评审）。
 */
import * as lifecycleModule from "./lifecycle";
import { describe, expect, it } from "vitest";
import { PRODUCT_ACTIONS, canLaunchFrom, type ProductState } from "./lifecycle";

describe("canLaunchFrom", () => {
  it("developing 能确认上线（它与 draft 的区别是对外可见，不是离上线更远）", () => {
    expect(canLaunchFrom("developing")).toBe(true);
  });

  it("draft 能确认上线", () => {
    expect(canLaunchFrom("draft")).toBe(true);
  });

  it("已上线 / 已停用 / 已退役 不再出现「确认上线」", () => {
    for (const s of ["active", "inactive", "deprecated"] as ProductState[]) {
      expect(canLaunchFrom(s)).toBe(false);
    }
  });

  it("与动作表逐字同源：launch.from 里有的状态，且仅这些，能上线", () => {
    const launch = PRODUCT_ACTIONS.find((a) => a.id === "launch");
    expect(launch).toBeDefined();
    const all: ProductState[] = [
      "draft",
      "developing",
      "active",
      "inactive",
      "deprecated",
    ];
    for (const s of all) {
      expect(canLaunchFrom(s)).toBe(launch!.from.includes(s));
    }
  });
});

describe("接入检查的四个环节：每项落在它能被确认的那一屏", () => {
  it("launch 门 = 环节①②，stable 门 = 环节③④；未登记的项按 gate 兜底", () => {
    const { stageOfCheck, stageGatesLaunch, CHECKLIST_STAGES } =
      lifecycleModule;
    expect(CHECKLIST_STAGES.map((s) => s.key)).toEqual([
      "configure",
      "prelaunch",
      "publish",
      "verify",
    ]);
    for (const k of [
      "catalog_registered",
      "client",
      "atlas-grants",
      "runos-grants",
      "webhook",
    ]) {
      expect(stageOfCheck(k)).toBe("configure");
    }
    /* 环节②：登录实测 + 四项人工确认——上线前平台观测不到对方实现了没有。 */
    for (const k of [
      "c1_identity",
      "c1_s2s_declared",
      "c2_entitlement_declared",
      "c3_metering_declared",
      "webhook_receiver_declared",
    ]) {
      expect(stageOfCheck(k)).toBe("prelaunch");
    }
    expect(stageOfCheck("plan_published")).toBe("publish");
    /* 环节④：②里人工确认过的三件事，到这里由真实使用自动点亮。 */
    for (const k of [
      "tenant_subscribed",
      "c1_s2s",
      "c2_entitlement",
      "c3_metering",
    ]) {
      expect(stageOfCheck(k)).toBe("verify");
    }
    expect(stageOfCheck("brand_new_item", "launch")).toBe("prelaunch");
    expect(stageOfCheck("brand_new_item", "stable")).toBe("verify");
    expect(stageGatesLaunch("configure")).toBe(true);
    expect(stageGatesLaunch("prelaunch")).toBe(true);
    expect(stageGatesLaunch("publish")).toBe(false);
    expect(stageGatesLaunch("verify")).toBe(false);
  });
});
