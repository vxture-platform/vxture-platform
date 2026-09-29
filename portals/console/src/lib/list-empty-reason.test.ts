import { describe, expect, it } from "vitest";
import { listEmptyReason } from "./list-empty-reason";

describe("listEmptyReason", () => {
  it("全集空 ⇒ 真的一张都没有", () => {
    expect(listEmptyReason(0, 0)).toBe("none");
  });

  /**
   * 这一条就是生产上那个缺陷：租户有一张「已解决」的单，工单页默认筛选
   * `unresolved` 把它挡掉 ⇒ 可见集空、全集非空。
   *
   * 旧判据（`filter !== "unresolved"`）在这里给 false，于是页面说「还没有提过工单」
   * 并把动作画成「提交工单」——一句假话加一个把客户推去开重复单的按钮。
   */
  it("全集非空而可见集空 ⇒ 是被筛掉的（默认筛选也算筛）", () => {
    expect(listEmptyReason(1, 0)).toBe("filtered");
  });

  it("可见集非空 ⇒ 不画空态，答案取 none", () => {
    expect(listEmptyReason(5, 2)).toBe("none");
    expect(listEmptyReason(5, 5)).toBe("none");
  });

  /**
   * 判据不许认识任何一个具体的筛选值或默认值——这正是旧写法的病根：
   * 它把 `"unresolved"` 焊进了判据，于是「默认值会不会筛」变成了一个
   * 没人再去问的问题。这里只喂两个数字，函数签名本身就拿不到筛选器。
   */
  it("只看两个数，拿不到也不需要筛选器的身份", () => {
    for (const total of [0, 1, 7, 200]) {
      for (const visible of [0, 1, 3]) {
        if (visible > total) continue;
        expect(listEmptyReason(total, visible)).toBe(
          visible === 0 && total > 0 ? "filtered" : "none",
        );
      }
    }
  });
});
