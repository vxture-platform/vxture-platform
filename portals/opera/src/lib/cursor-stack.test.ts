import { describe, expect, it } from "vitest";
import {
  FIRST_PAGE,
  advance,
  currentCursor,
  goBack,
  hasPrevious,
  pageIndex,
  resetToFirst,
} from "./cursor-stack";

/**
 * 游标栈的不变式（`vxture-platform#306`）。
 *
 * 这几条原先写在目录页的组件里，唯一的验证方式是读代码。其中「reset 在第一页返回同一
 * 引用」这一条**肉眼看不出后果**——返回新数组不会报错、界面也正常，只是每敲一个字符
 * 多发一次请求，而那正是防抖要消掉的东西。
 */

describe("游标栈", () => {
  it("第一页没有游标，也回不去", () => {
    expect(currentCursor(FIRST_PAGE)).toBeNull();
    expect(pageIndex(FIRST_PAGE)).toBe(0);
    expect(hasPrevious(FIRST_PAGE)).toBe(false);
  });

  it("往前翻留着用过的游标，往回翻就是弹栈", () => {
    const page2 = advance(FIRST_PAGE, "c1");
    const page3 = advance(page2, "c2");

    expect(currentCursor(page3)).toBe("c2");
    expect(pageIndex(page3)).toBe(2);
    expect(currentCursor(goBack(page3))).toBe("c1");
    expect(currentCursor(goBack(goBack(page3)))).toBeNull();
  });

  it("最后一页不往前翻——不把 null 推进栈", () => {
    /* 推进去的话 `currentCursor` 会返回 null，于是「下一页」把人送回第一页，
       而页序号却继续加——共 886 条、第 5 页、显示的是第 1 页的内容。 */
    const page2 = advance(FIRST_PAGE, "c1");

    expect(advance(page2, null)).toBe(page2);
  });

  it("在第一页不往回弹空", () => {
    expect(goBack(FIRST_PAGE)).toBe(FIRST_PAGE);
    expect(pageIndex(goBack(FIRST_PAGE))).toBe(0);
  });

  it("reset 从任意页回到第一页", () => {
    const page3 = advance(advance(FIRST_PAGE, "c1"), "c2");

    expect(resetToFirst(page3)).toEqual([null]);
    expect(hasPrevious(resetToFirst(page3))).toBe(false);
  });

  it("**已经在第一页时 reset 返回同一个引用**，不是相等的新数组", () => {
    /* 决定性的一条。调用方把这个栈放进 effect 依赖，每敲一个字符调一次 reset;
       返回新数组就每次都触发取数——防抖白做。`toBe` 而不是 `toEqual`:两者的区别
       正是这条不变式本身。 */
    const stack = resetToFirst(FIRST_PAGE);

    expect(stack).toBe(FIRST_PAGE);
  });

  it("回到第一页之后，下一页用的是第一页的游标（null），不是残留的", () => {
    const page3 = advance(advance(FIRST_PAGE, "c1"), "c2");

    expect(currentCursor(resetToFirst(page3))).toBeNull();
  });
});
