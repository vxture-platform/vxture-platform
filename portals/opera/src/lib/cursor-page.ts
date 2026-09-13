/**
 * 游标翻页的位置 —— 双向 keyset 下「我在哪一页、四颗按钮各通向哪里」的全部状态。
 *
 * ## 为什么不再是一个栈
 *
 * 这个文件取代了 `cursor-stack.ts`。栈的做法是:游标只能往前走，所以把**用过的**游标
 * 留着，回上一页就弹栈。那在单向 keyset 下是唯一可行的办法。
 *
 * runos 加了反向游标之后（runos#100，`?dir=before`），上游每一页同时给回
 * `prevCursor` 与 `nextCursor`——两端都拿得到，栈就没必要了。位置退化成三个值:
 *
 *     { cursor, dir, pageNo }
 *
 * 栈还有一个**做不到**的事，也是这次换掉它的直接原因:**跳到末页之后，栈是空的**。
 * 没有走过去的路径，就没有可弹的游标，「上一页」只能禁用——末页变成死胡同，进去只能
 * 按首页重走。位置模型没有这个问题:末页也带着自己的 `prevCursor`。
 *
 * ## 页码为什么单独记
 *
 * `pageNo` 不是从游标推出来的（推不出来），是**按导航动作维护的**:下一页 +1、上一页
 * −1、首页归 1、末页设成 `pageCount`。跳不了任意页是 keyset 的限制，但那不等于连自己
 * 在第几页都说不出。
 *
 * 抽成纯函数是照 console 的约定（见 `portals/console/vitest.config.ts`）:门户只测
 * `src/lib/**` 里不碰 React / Next 的逻辑。这几个转移写在组件里的话，**唯一的验证方式
 * 就是读代码**——而其中一条（`toFirst` 的引用相等）肉眼看不出后果。
 */

/** 取数方向。与 runos 的 `?dir=` 同名同义。 */
export type CursorDirection = "after" | "before";

export interface CursorPage {
  /** 本次取数带的游标。`null` = 不带——配合 `dir` 表示第一页或最后一页。 */
  readonly cursor: string | null;
  readonly dir: CursorDirection;
  /** 1 起。用来显示「第 X / Y 页」。 */
  readonly pageNo: number;
}

/** 第一页:不带游标，往后取。 */
export const FIRST_PAGE: CursorPage = { cursor: null, dir: "after", pageNo: 1 };

/** 上游给回的那两个游标。两端都可能没有（第一页没有前、最后一页没有后）。 */
export interface PageCursors {
  readonly prevCursor: string | null;
  readonly nextCursor: string | null;
}

export function hasPrevious(page: CursorPage, cursors: PageCursors): boolean {
  return cursors.prevCursor !== null && page.pageNo > 1;
}

export function hasNext(cursors: PageCursors): boolean {
  return cursors.nextCursor !== null;
}

/**
 * 往后一页。没有下一页时**原样返回**——不推一个空游标进去。
 *
 * 推进去的话下一页会退化成「不带游标往后取」，也就是第一页，而 `pageNo` 却继续加:
 * 界面显示第 5 页、内容是第 1 页的。
 */
export function toNext(page: CursorPage, cursors: PageCursors): CursorPage {
  if (cursors.nextCursor === null) return page;
  return { cursor: cursors.nextCursor, dir: "after", pageNo: page.pageNo + 1 };
}

/** 往前一页。已经在第一页、或上游说没有前一页时原样返回。 */
export function toPrevious(page: CursorPage, cursors: PageCursors): CursorPage {
  if (cursors.prevCursor === null || page.pageNo <= 1) return page;
  return { cursor: cursors.prevCursor, dir: "before", pageNo: page.pageNo - 1 };
}

/**
 * 回第一页。
 *
 * **已经在第一页时返回同一个引用**，不是一个内容相等的新对象。这条是有后果的:调用方
 * 把这个位置放进 `useEffect` 依赖，每敲一个字符都会调一次;返回新对象就会每次都触发一次
 * 取数——**而那正是防抖要消掉的东西**。
 */
export function toFirst(page: CursorPage): CursorPage {
  return page.pageNo === 1 && page.cursor === null && page.dir === "after"
    ? page
    : FIRST_PAGE;
}

/**
 * 跳到最后一页:不带游标 + `before`。
 *
 * 这是双向游标带来的那一件——单向 keyset 跳不到末页。`pageCount` 由 `total` 与页大小
 * 算出，只用来把 `pageNo` 摆对，不参与取数。
 */
export function toLast(pageCount: number): CursorPage {
  return { cursor: null, dir: "before", pageNo: Math.max(1, pageCount) };
}

/** 总页数。`total` 为 0 时是 1 页（空表也是一页，不是零页）。 */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
