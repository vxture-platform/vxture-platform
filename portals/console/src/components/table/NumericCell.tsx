"use client";

/**
 * NumericCell.tsx — 表格「数值列」的单元格(owner 2026-09-07 定的全站表格对齐规范)。
 * @package @vxture/console
 * @layer Presentation
 * @category Component
 *
 * 规范全文(适用于所有表格,不只本页):
 *   · 选择列 / 序号列 / 末尾操作列 —— 居中(DS `DataTable` 自己管,调用方不用写)
 *   · 首列(标题列)—— 局左
 *   · 数值列 —— 按本件
 *   · 其余列 —— 一律 `align: "center"`
 *
 * 最后一条与 DS 的列注释不一致:DS 写的是「其余文本列留默认(left)」。以本规范为准,
 * 代价是每个非首列都要**显式**写 `align: "center"`——DS 的默认值不会帮忙。
 *
 * 数值列为什么要一个组件而不是 `align: "right"`:DS 的 `align` 只映射到
 * `text-left|center|right`,没有留白与块宽的概念。直接 `right` 会让数字贴着列边,
 * 而且列宽随内容浮动时上下行的数字对不齐。本件把数值放进一个**等宽的块**:
 *   · 块等宽 —— `min-w-[9ch]` + `tabular-nums`,数字位宽一致,于是一列数字真的对齐
 *   · 块居中 —— 列标 `align: "center"`,居中的是这个块(不是文字)
 *   · 值居右 —— 块内 `items-end`
 *   · 右侧留白 —— `pr-md`,不贴列边
 * `ch` 是这里唯一说得通的单位:块要容纳的是数字,而 `tabular-nums` 下一个 `ch`
 * 正好是一位数字的宽度。media / panel 那两套宽度令牌是图片与面板尺度,用在这里
 * 会宽出一个量级。
 */

import type { ReactNode } from "react";

export interface NumericCellProps {
  /** 主值,通常是格式化后的金额或计数。 */
  readonly value: ReactNode;
  /** 副行(折扣、单位、同比一类)。没有就不渲染,不留空行。 */
  readonly sub?: ReactNode;
}

export function NumericCell({ value, sub }: NumericCellProps) {
  return (
    <span className="inline-flex min-w-[9ch] flex-col items-end pr-md tabular-nums">
      <span className="font-semibold text-foreground">{value}</span>
      {sub ? (
        <span className="text-body-sm font-normal text-muted-foreground">
          {sub}
        </span>
      ) : null}
    </span>
  );
}
