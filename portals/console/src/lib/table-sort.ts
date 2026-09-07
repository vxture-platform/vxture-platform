"use client";

/**
 * table-sort.ts — 表格排序的共用实现（owner 2026-09-07：标题列、数值列、金额列要能排）。
 * @package @vxture/console
 * @layer Application
 *
 * DS 的 `DataTable` **只出表头控件与方向指示，排序本身归调用方**（见件的 `sortable`
 * 注释）。所以每张表都要自己排——散着写就是 21 份各不相同的比较函数，本件把它收成
 * 一处。
 *
 * ## 只用在「行全在内存里」的表上
 *
 * 服务端分页的表**不能用本件**：它手上只有当前这一页，排出来的是「这 10 条里的顺序」，
 * 而用户以为看到的是「全部里最大的 10 条」。那是**在界面上说假话**，比不给排序糟得多。
 * 那类表要排，得由 BFF 支持 `order by`（console 目前是账单记录与调用记录两张）。
 *
 * ## 取值器给的是**可比较的原始值**，不是渲染结果
 *
 * 单元格渲染出来的可能是徽标、两行主副、带单位的字符串（「1.2 GB」）。按渲染结果排
 * 会得到字典序——`1.2 GB` 排在 `900 MB` 前面。所以取值器要返回**排序用的那个数或串**
 * （字节数、时间戳、金额数值），与展示各管各的。
 */

import { useCallback, useMemo, useState } from "react";
import type { DataTableSort } from "@vxture/design-system";

/** 一列的排序取值：返回可比较的原始值；`null` 一律排在最后（不论升降）。 */
export type SortAccessor<T> = (row: T) => string | number | null | undefined;

export interface UseTableSortResult<T> {
  /** 传给 `DataTable.sort`。未排序时是 `undefined`——列头两支箭头都不亮。 */
  readonly sort: DataTableSort | undefined;
  readonly onSortChange: (next: DataTableSort) => void;
  /** 排过序的行；没有生效的排序时原样返回，不复制数组。 */
  readonly rows: readonly T[];
}

/**
 * @param rows      本表的**全部**行（不是当前页）
 * @param accessors 列 id → 取值器。只有出现在这里的列才排得动；列上还要标
 *                  `sortable: true`，两者缺一不可——标了却没取值器会得到一个点了
 *                  不动的控件，那正是 DS 反复躲的东西。
 */
export function useTableSort<T>(
  rows: readonly T[],
  accessors: Readonly<Record<string, SortAccessor<T>>>,
): UseTableSortResult<T> {
  const [sort, setSort] = useState<DataTableSort | undefined>(undefined);

  const onSortChange = useCallback((next: DataTableSort) => {
    setSort(next);
  }, []);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const pick = accessors[sort.columnId];
    if (!pick) return rows; // 没给取值器：不装作排过
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = pick(a);
      const y = pick(b);
      // 空值恒定沉底：升序时它不该冒到最前，降序时也不该——「没有值」不是一个极值。
      if (x === null || x === undefined)
        return y === null || y === undefined ? 0 : 1;
      if (y === null || y === undefined) return -1;
      if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
      return (
        String(x).localeCompare(String(y), undefined, { numeric: true }) * dir
      );
    });
  }, [rows, sort, accessors]);

  return { sort, onSortChange, rows: sorted };
}
