/**
 * launch-checks.spec.ts —— 「全部通过」到底数哪几条。
 *
 * 只钉 `allPassed()` 这一个纯函数，因为它是整份上线检查里**唯一能让按钮点不动**的
 * 判据：`LaunchDrawer` 的 `confirmLaunch()` 拿它决定要不要逼人写跳过理由。
 *
 * ── 为什么这份文件是 2026-09-17 才出现的 ──
 * 那天往检查里加「开通回执」时才发现，`allPassed()` 数的是 `runLaunchChecks()` 的
 * **全部**返回值，而抽屉里显示哪几条由另一张表（`MEASURE_ONLY`）决定。两者不是同一个
 * 集合，于是可以有一条**界面上不存在、却一票否决上线**的检查——`acceptance-chain`
 * 当时正落在这个缝里。加一条谁都还没实现的新约定进来，会把每个产品的上线都推进
 * 「带理由跳过」那条路，而按钮上看不出是被哪一条挡的。
 *
 * 所以这里钉的不是「advisory 这个字段存在」，是**它真的被排除在判定之外**。
 */
import { describe, expect, it } from "vitest";
import { allPassed, type CheckResult } from "./launch-checks";

function check(over: Partial<CheckResult>): CheckResult {
  return {
    id: "x",
    label: "x",
    what: "",
    side: "ours",
    status: "pass",
    detail: "",
    remedy: null,
    ...over,
  };
}

describe("allPassed —— 只数参与判定的那些", () => {
  it("全通过：true", () => {
    expect(allPassed([check({ id: "a" }), check({ id: "b" })])).toBe(true);
  });

  it("有一条未通过：false", () => {
    expect(
      allPassed([check({ id: "a" }), check({ id: "b", status: "fail" })]),
    ).toBe(false);
  });

  it("**advisory 未通过不算数**——这一条错了，每个产品的上线都会被逼着写理由", () => {
    expect(
      allPassed([
        check({ id: "a" }),
        check({ id: "ack", status: "fail", advisory: true }),
      ]),
    ).toBe(true);
  });

  it("advisory 通过了也不改变结论——它不是加分项", () => {
    expect(
      allPassed([
        check({ id: "a", status: "fail" }),
        check({ id: "ack", advisory: true }),
      ]),
    ).toBe(false);
  });

  it("只有 advisory 条目：false，不能因为没有硬条件就宣布全通过", () => {
    expect(allPassed([check({ id: "ack", advisory: true })])).toBe(false);
  });

  it("空数组：false（读不到不等于通过，与全文件的失败方向一致）", () => {
    expect(allPassed([])).toBe(false);
  });
});
