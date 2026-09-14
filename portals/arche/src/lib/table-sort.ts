"use client";

/**
 * table-sort.ts — 表格排序（行全在内存里的表）。
 * @package @vxture/arche
 * @layer Application
 *
 * DS 的 `DataTable` **只出表头控件与方向指示，排序本身归调用方**（见件的 `sortable`
 * 注释）。本件与 console 的 `lib/table-sort.ts` 同一实现——三个平台可以重复，不能耦合，
 * 所以各自一份，不跨门户导入。
 *
 * ## 只用在「行全在内存里」的表上
 *
 * 截断的列表（审计日志、发送记录、风险记录、合规事件、登录记录——BFF 截在 500 条）
 * **不能用本件**：前端手上只有那一段，排出来的「最早的」不是全表最早的。那几张表把
 * 排序交给 BFF（`sort` / `order` 参数，白名单），页面只持有排序状态。
 *
 * ## 取值器给的是**可比较的原始值**，不是渲染结果
 *
 * 单元格渲染出来的可能是徽标、两行主副。按渲染结果排会得到字典序，所以取值器返回
 * 排序用的那个数或串（时间戳、计数、枚举的序号）。
 */

import { useCallback, useMemo, useState } from "react";
import type { DataTableSort } from "@vxture/design-system";

/** 一列的排序取值：返回可比较的原始值；`null` 一律排在最后（不论升降）。 */
export type SortAccessor<T> = (row: T) => string | number | null | undefined;

export interface UseTableSortResult<T> {
  /** 传给 `DataTable.sort`。未排序时是 `undefined`。 */
  readonly sort: DataTableSort | undefined;
  readonly onSortChange: (next: DataTableSort) => void;
  /** 排过序的行；没有生效的排序时原样返回，不复制数组。 */
  readonly rows: readonly T[];
}

/**
 * @param rows      本表的**全部**行（不是当前页）
 * @param accessors 列 id → 取值器。列上还要标 `sortable: true`，两者缺一不可。
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
    if (!pick) return rows;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = pick(a);
      const y = pick(b);
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

/** 截断列表的服务端排序参数：没有排序时不带参数（BFF 用默认序）。 */
export function sortParams(sort: DataTableSort | undefined): {
  sort?: string;
  order?: "asc" | "desc";
} {
  return sort ? { sort: sort.columnId, order: sort.direction } : {};
}
