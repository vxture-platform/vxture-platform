/**
 * lifecycle.spec.ts —— 「加一档状态」与「这一档进得去出得来」是两半（2026-09-27）。
 *
 * 2026-09-24 接 `developing` 时，PRODUCT_ACTIONS 的 launch.from 与 BFF 的 STATE_TRANSITIONS
 * 都放行了它，但 LaunchDrawer 的页脚仍写死 `state === "draft"`——13 个开发中的产品在界面上
 * 只看得到「只做复验」。渲染条件现在收成 `canLaunchFrom`，这份 spec 钉住它与动作表同源：
 * 故意把 launch.from 里的 developing 删掉，第一条会红；故意把 LaunchDrawer 改回写死 draft，
 * 这里不会红——所以渲染处只许调这个函数，别再写状态名（lint 拦不住，靠评审）。
 */
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
