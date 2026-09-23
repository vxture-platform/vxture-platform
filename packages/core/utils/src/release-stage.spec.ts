/**
 * release-stage.spec.ts —— 承诺等级轴的几条性质。
 *
 * 钉的不是「函数返回了什么」，而是错了不会报错的那几件事：
 *
 *  1. **承诺只向前走。** `stable → preview` 倒退会让官网当场把一个已发布产品的订阅
 *     入口换成「敬请期待」，而接口回 200。同态重放必须放行——反复保存同一张表单是
 *     常事，把它当非法迁移会把编辑框卡死。
 *  2. **未登记值一律不放行。** 枚举外的字符串如果被当成「可以迁移」，这道门就有一个
 *     永远开着的口子。
 *  3. **可订性只可能在 `sunset` 那一步失去。** 2026-10-29 加 `sunset` 之前，这根轴有一条
 *     更强的性质：「起点不可订 + 只能向前走 ⇒ 一旦可订就不会再变回不可订」。`sunset`
 *     有意打破了它——停售的定义就是**拦新单**。下面把它收窄成仍然成立的形式，并钉住
 *     「除 sunset 外没有第二条这样的边」：真正危险的是**悄悄多出一条**。
 *
 * ⚠ `sunset` 拦的是新单，**不拦续订**。那一半不在本文件——它在 console-bff 的下单守卫里
 *   （按 intent 分：new/upgrade 拦、renew 放行）。少了它就会重犯 `plans.is_public` 当年
 *   的错：把一个在售档改成邀请制连带掐断了老客户续订，界面上只是 409，而客户什么都没
 *   做错。本文件的性质 3 成立并不代表那一半已经做了。
 */
import { describe, expect, it } from "vitest";

import {
  isForwardReleaseStageMove,
  isReleaseStageSubscribable,
  RELEASE_STAGES,
} from "./release-stage";

describe("isForwardReleaseStageMove", () => {
  it("向前的边都放行（含跨级）", () => {
    expect(isForwardReleaseStageMove("preview", "beta")).toBe(true);
    expect(isForwardReleaseStageMove("beta", "stable")).toBe(true);
    expect(isForwardReleaseStageMove("preview", "stable")).toBe(true);
    expect(isForwardReleaseStageMove("stable", "sunset")).toBe(true);
    expect(isForwardReleaseStageMove("preview", "sunset")).toBe(true);
  });

  it("倒退一律拒绝", () => {
    expect(isForwardReleaseStageMove("stable", "beta")).toBe(false);
    expect(isForwardReleaseStageMove("stable", "preview")).toBe(false);
    expect(isForwardReleaseStageMove("beta", "preview")).toBe(false);
    /* sunset 是终点：回到在售是一次有主体、该留痕的决定，不从这个函数开口子。 */
    expect(isForwardReleaseStageMove("sunset", "stable")).toBe(false);
  });

  it("同态重放放行——反复保存同一张表单不该报错", () => {
    for (const s of RELEASE_STAGES) {
      expect(isForwardReleaseStageMove(s, s)).toBe(true);
    }
  });

  it("未登记值不放行（两端任一个越界都算）", () => {
    expect(isForwardReleaseStageMove("stable", "retired")).toBe(false);
    expect(isForwardReleaseStageMove("retired", "stable")).toBe(false);
    expect(isForwardReleaseStageMove("", "stable")).toBe(false);
    /* 旧码在改名之后必须当成越界值，不能还认得——认得就说明改名没改干净。 */
    expect(isForwardReleaseStageMove("ga", "stable")).toBe(false);
    expect(isForwardReleaseStageMove("developing", "beta")).toBe(false);
  });

  it("每一个受管值都能到达终点 sunset（轴上没有孤岛）", () => {
    for (const s of RELEASE_STAGES) {
      expect(isForwardReleaseStageMove(s, "sunset")).toBe(true);
    }
  });
});

describe("isReleaseStageSubscribable 与状态机的关系", () => {
  it("不可订的恰好是起点 preview 与终点 sunset", () => {
    const notSubscribable = RELEASE_STAGES.filter(
      (s) => !isReleaseStageSubscribable(s),
    );
    expect(notSubscribable).toEqual(["preview", "sunset"]);
  });

  it("可订 → 不可订 的前向边只有 *→sunset 一条", () => {
    /* 多出第二条就意味着「承诺往前走了一步，客户反而买不了了」，而那不该无声发生。
       这条断言在值域或 subscribable 被改动时会立刻红——它守的正是「悄悄多出一条」。 */
    const lossEdges: string[] = [];
    for (const from of RELEASE_STAGES) {
      if (!isReleaseStageSubscribable(from)) continue;
      for (const to of RELEASE_STAGES) {
        if (!isForwardReleaseStageMove(from, to)) continue;
        if (from === to) continue;
        if (isReleaseStageSubscribable(to)) continue;
        lossEdges.push(`${from}->${to}`);
      }
    }
    expect([...new Set(lossEdges.map((e) => e.split("->")[1]))]).toEqual([
      "sunset",
    ]);
  });
});
