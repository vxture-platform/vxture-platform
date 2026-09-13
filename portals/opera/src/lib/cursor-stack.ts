/**
 * 游标栈 —— keyset 分页里「我现在在第几页、上一页怎么回去」的全部状态。
 *
 * keyset 游标只知道「从这一行之后再来一页」，回不去。所以往回翻的做法不是**算**一个
 * 游标，而是**留着用过的**:第 i 项是取到第 i+1 页用的那个游标，回上一页就是弹栈。
 * 往回算要求知道上一页的第一行是谁，而那正是翻过去之后就不再持有的东西。
 *
 * 抽成纯函数是照 console 的约定（见 `portals/console/vitest.config.ts`）:门户只测
 * `src/lib/**` 里不碰 React / Next 的逻辑，页面本身靠 tsc / 守卫 / 走查。这几个转移
 * 原先写在组件里，于是**唯一的验证方式是读代码**——而其中至少一条不变式（`reset` 的
 * 引用相等）是肉眼看不出后果的。
 */

/** 第一页不需要游标，所以栈底是 `null`。 */
export type CursorStack = readonly (string | null)[];

export const FIRST_PAGE: CursorStack = [null];

/** 取当前页要用的游标。第一页是 `null`。 */
export function currentCursor(stack: CursorStack): string | null {
  return stack[stack.length - 1] ?? null;
}

/** 0 起的页序号，用来算行号起点。 */
export function pageIndex(stack: CursorStack): number {
  return stack.length - 1;
}

export function hasPrevious(stack: CursorStack): boolean {
  return stack.length > 1;
}

/**
 * 往前一页。`nextCursor` 为 null（已是最后一页）时**原样返回**，不推一个空位进去。
 */
export function advance(
  stack: CursorStack,
  nextCursor: string | null,
): CursorStack {
  return nextCursor === null ? stack : [...stack, nextCursor];
}

/** 往回一页。已经在第一页时原样返回，不会弹空。 */
export function goBack(stack: CursorStack): CursorStack {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

/**
 * 回到第一页。换筛选、换页大小时必须调——游标是「某一行之后」，筛选变了那一行可能
 * 已经不在结果里，页大小变了它前面看过的行数也变了，继续用都会漏行或重复。
 *
 * **已经在第一页时返回同一个引用**，不是一个内容相等的新数组。这条是有后果的:调用方
 * 把这个栈放进 `useEffect` 依赖，每敲一个字符都会调一次 reset，返回新数组就会每次都
 * 触发一次取数——**而那正是防抖要消掉的东西**。React 对同一引用会跳过重渲染。
 */
export function resetToFirst(stack: CursorStack): CursorStack {
  return stack.length === 1 ? stack : FIRST_PAGE;
}
