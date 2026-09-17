/**
 * release-stage.spec.ts —— 成熟度轴的两条性质。
 *
 * 钉的不是「函数返回了什么」，而是两件错了不会报错的事：
 *
 *  1. **成熟度只向前走。** `ga → developing` 倒退会让官网当场把一个已发布产品的
 *     订阅入口换成「敬请期待」，而接口回 200。同态重放必须放行——反复保存同一
 *     张表单是常事，把它当非法迁移会把编辑框卡死。
 *  2. **未登记值一律不放行。** 枚举外的字符串如果被当成「可以迁移」，这道门就有一
 *     个永远开着的口子。
 */
import { describe, expect, it } from "vitest";

import {
  isForwardReleaseStageMove,
  isReleaseStageSubscribable,
  RELEASE_STAGES,
} from "./release-stage";

describe("isForwardReleaseStageMove", () => {
  it("向前的三条边都放行（含跨级）", () => {
    expect(isForwardReleaseStageMove("developing", "beta")).toBe(true);
    expect(isForwardReleaseStageMove("beta", "ga")).toBe(true);
    expect(isForwardReleaseStageMove("developing", "ga")).toBe(true);
  });

  it("倒退一律拒绝", () => {
    expect(isForwardReleaseStageMove("ga", "beta")).toBe(false);
    expect(isForwardReleaseStageMove("ga", "developing")).toBe(false);
    expect(isForwardReleaseStageMove("beta", "developing")).toBe(false);
  });

  it("同态重放放行——反复保存同一张表单不该报错", () => {
    for (const s of RELEASE_STAGES) {
      expect(isForwardReleaseStageMove(s, s)).toBe(true);
    }
  });

  it("未登记值不放行（两端任一个越界都算）", () => {
    expect(isForwardReleaseStageMove("ga", "retired")).toBe(false);
    expect(isForwardReleaseStageMove("retired", "ga")).toBe(false);
    expect(isForwardReleaseStageMove("", "ga")).toBe(false);
  });

  it("每一个受管值都能到达 ga（轴上没有孤岛）", () => {
    for (const s of RELEASE_STAGES) {
      expect(isForwardReleaseStageMove(s, "ga")).toBe(true);
    }
  });
});

describe("isReleaseStageSubscribable 与状态机的关系", () => {
  it("不可订的只有 developing，且它是起点", () => {
    const notSubscribable = RELEASE_STAGES.filter(
      (s) => !isReleaseStageSubscribable(s),
    );
    expect(notSubscribable).toEqual(["developing"]);
    /* 起点不可订 + 只能向前走 = 一旦可订就不会再变回不可订。
       这条性质是「已订阅客户不会因为成熟度变动而失去续费路径」的依据。 */
    for (const s of RELEASE_STAGES) {
      if (!isReleaseStageSubscribable(s)) continue;
      expect(isForwardReleaseStageMove(s, "developing")).toBe(false);
    }
  });
});
