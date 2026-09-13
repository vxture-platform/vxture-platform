"use client";

/**
 * CursorPagination.tsx — 游标列表的分页条:共 N 条 + 上一页/下一页。
 * @package @vxture/opera
 * @layer Presentation
 * @category Modules - Shared
 *
 * ## 为什么不是 `ListPagination`
 *
 * `ListPagination`（DS `Pagination`）是**页码式**的:它渲染 1…N 并允许随机跳页。那要求
 * 数据源能按「第 k 页」取数——offset 能，**keyset 游标不能**。游标只知道「从这一行之后
 * 再来一页」，要跳到第 9 页就得连发 8 次请求;页大小 10 时跳到第 89 页就是 88 次。
 *
 * 那条限制不是缺陷，是那个选择本身:游标换来的是**目录被批量开采写入时不跳行、不重复**
 * （runos `catalog-cursor.ts`）。预置台账一次提交就能让目录从 288 涨到 877，offset 的
 * 页边界在两次请求之间会移动几百行。
 *
 * 所以两个控件各管一种数据源，判据只有一条:
 *
 * > **能随机取第 k 页就用 `ListPagination`，只能顺着走就用这个。**
 *
 * 文案全部取自同一个 `pagination` 命名空间（`total` / `previous` / `next` /
 * `pageSizeLabel` / `pageSizeOption`），**不新增键**——两个控件说的是同一件事，计数语
 * 尤其要一字不差，否则同一个平面上会出现两种「共 N 条」。
 *
 * 页大小档与 `ListPagination` 一致（10/20/50/100，无 auto，owner 2026-09-02 定）。
 * 改页大小会把游标作废并回到第一页——**这是必须的**:游标是「某一行之后」，换了页大小
 * 之后它指向的位置还在，但前面已经看过的行数变了，不回第一页就会漏掉或重复。
 */

import { useTranslations } from "next-intl";
import { Button, NativeSelect } from "@vxture/design-system";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type CursorPageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export interface CursorPaginationProps {
  /** 匹配总数——**不是本页条数**。翻页时这个数必须钉住不动。 */
  readonly total: number;
  readonly pageSize: CursorPageSize;
  readonly onPageSizeChange: (value: CursorPageSize) => void;
  /** 能不能往回:第一页时为 false。 */
  readonly hasPrevious: boolean;
  /** 能不能往前:上游给了 `nextCursor` 才为 true。 */
  readonly hasNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  /** 取数中:两侧都禁用，避免连点把游标栈推乱。 */
  readonly busy?: boolean;
  readonly className?: string;
}

export function CursorPagination({
  total,
  pageSize,
  onPageSizeChange,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  busy = false,
  className,
}: CursorPaginationProps) {
  const t = useTranslations("pagination");

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 ${className ?? ""}`}
    >
      <span className="text-body-sm text-muted-foreground tabular-nums">
        {t("total", { total })}
      </span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-body-sm text-muted-foreground">
          {t("pageSizeLabel")}
          <NativeSelect
            wrapperClassName="w-fit"
            value={String(pageSize)}
            onChange={(event) =>
              onPageSizeChange(Number(event.target.value) as CursorPageSize)
            }
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {t("pageSizeOption", { size })}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrevious || busy}
          onClick={onPrevious}
        >
          {t("previous")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasNext || busy}
          onClick={onNext}
        >
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
