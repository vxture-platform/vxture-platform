import { describe, expect, it } from "vitest";
import {
  FIRST_PAGE,
  hasNext,
  hasPrevious,
  pageCountOf,
  toFirst,
  toLast,
  toNext,
  toPrevious,
  type PageCursors,
} from "./cursor-page";

/**
 * 双向游标翻页的不变式（vxture-platform#306 后续，runos#100）。
 *
 * 这几条原先以「游标栈」的形式写在目录页的组件里，唯一的验证方式是读代码。其中
 * `toFirst` 的引用相等那一条**肉眼看不出后果**——返回新对象不报错、界面也正常，只是每
 * 敲一个字符多发一次请求，把防抖抵消掉。
 */

const both: PageCursors = { prevCursor: "p", nextCursor: "n" };
const firstPage: PageCursors = { prevCursor: null, nextCursor: "n" };
const lastPage: PageCursors = { prevCursor: "p", nextCursor: null };
const onlyPage: PageCursors = { prevCursor: null, nextCursor: null };

describe("游标位置", () => {
  it("第一页没有前一页，有下一页", () => {
    expect(hasPrevious(FIRST_PAGE, firstPage)).toBe(false);
    expect(hasNext(firstPage)).toBe(true);
    expect(FIRST_PAGE.pageNo).toBe(1);
  });

  it("往后翻:带上游给的 nextCursor，方向 after，页码 +1", () => {
    const p2 = toNext(FIRST_PAGE, firstPage);

    expect(p2).toEqual({ cursor: "n", dir: "after", pageNo: 2 });
  });

  it("往前翻:带 prevCursor，方向 **before**，页码 −1", () => {
    /* 方向必须跟着换。留在 after 的话，「上一页」会拿着前一行的游标往后取——
       取回来的正是当前这一页，界面上表现为按钮点了没反应。 */
    const p2 = toNext(FIRST_PAGE, firstPage);

    expect(toPrevious(p2, both)).toEqual({
      cursor: "p",
      dir: "before",
      pageNo: 1,
    });
  });

  it("最后一页:不带游标 + before —— 单向 keyset 做不到的那一件", () => {
    expect(toLast(44)).toEqual({ cursor: null, dir: "before", pageNo: 44 });
  });

  it("**末页不是死胡同**:它带着自己的 prevCursor，往回翻得动", () => {
    /* 这是换掉「游标栈」的直接原因。栈的做法下，跳到末页时栈是空的——没有走过去的
       路径就没有可弹的游标，「上一页」只能禁用，进去只能按首页重走。 */
    const last = toLast(44);

    expect(hasPrevious(last, lastPage)).toBe(true);
    expect(toPrevious(last, lastPage)).toEqual({
      cursor: "p",
      dir: "before",
      pageNo: 43,
    });
  });

  it("没有下一页时不往后翻——不把 null 推成「不带游标」", () => {
    /* 推进去的话下一页会退化成「不带游标往后取」，也就是第一页，而页码却继续加:
       界面显示第 5 页、内容是第 1 页的。 */
    const last = toLast(44);

    expect(toNext(last, lastPage)).toBe(last);
  });

  it("在第一页不往前弹", () => {
    expect(toPrevious(FIRST_PAGE, firstPage)).toBe(FIRST_PAGE);
    expect(toPrevious(FIRST_PAGE, both)).toBe(FIRST_PAGE);
  });

  it("**已经在第一页时 toFirst 返回同一个引用**，不是相等的新对象", () => {
    /* 决定性的一条。调用方把位置放进 effect 依赖，每敲一个字符调一次 toFirst;
       返回新对象就每次都触发取数——防抖白做。`toBe` 而不是 `toEqual`:两者的区别
       正是这条不变式本身。 */
    expect(toFirst(FIRST_PAGE)).toBe(FIRST_PAGE);
  });

  it("从任意页回第一页，方向与游标都归位", () => {
    const deep = toLast(44);

    expect(toFirst(deep)).toEqual({ cursor: null, dir: "after", pageNo: 1 });
  });

  it("只有一页时两侧都不可翻", () => {
    expect(hasPrevious(FIRST_PAGE, onlyPage)).toBe(false);
    expect(hasNext(onlyPage)).toBe(false);
  });

  it("空表算一页，不是零页", () => {
    /* 「第 1 / 0 页」读起来像坏了。 */
    expect(pageCountOf(0, 20)).toBe(1);
    expect(pageCountOf(878, 20)).toBe(44);
    expect(pageCountOf(20, 20)).toBe(1);
  });
});
