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
 * ## 两个 class 写错的记录，以及它们**不是同一种错**
 *
 * 本件初版写了 `text-vx-sm` 和 `gap-3`，两个都是照印象编的。数用量能把它们一起找出来
 * （全仓各 2 次，而那 2 次都是自己写的;对照 `text-muted-foreground` 135 次、
 * `gap-sm` 232 次）——**但数用量只给嫌疑，不给判决**。grep 产物 CSS 才分得开:
 *
 *   `.text-vx-sm`  → 产物里 **0 次**。彻底不存在，页面上那行字没有字号。
 *   `.gap-3`       → `.gap-3{gap:calc(var(--spacing) * 3)}`，而 `--spacing: .25rem`
 *                    确实有定义。**它是生效的。**
 *
 * 所以数字档不是坏的，是**不合约定**:它绕开 DS 的 `--space-*` 标尺，令牌改了它不跟。
 * 本件用 `gap-sm` / `gap-2xs`，与 `capability/registry/page.tsx:1738` 那条同族工具条
 * 一致。
 *
 * 记这一段是因为**「看起来一样的两个错，代价差很多」**:一个是页面坏了，一个是将来
 * 对不齐。把它们混为一谈会让人要么放过真坏的，要么把没坏的当事故查。
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
  /** 当前页，1 起。用来显示「第 X / Y 页」——keyset 跳不了任意页，但**说得出自己在哪**。 */
  readonly page: number;
  /** 能不能往回:第一页时为 false。 */
  readonly hasPrevious: boolean;
  /** 能不能往前:上游给了 `nextCursor` 才为 true。 */
  readonly hasNext: boolean;
  /** 回第一页。**keyset 唯一做得到的随机跳转**——第一页不需要游标。 */
  readonly onFirst: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  /** 取数中:两侧都禁用，避免连点把游标栈推乱。 */
  readonly busy?: boolean;
  readonly className?: string;
}

export function CursorPagination({
  total,
  page,
  pageSize,
  onPageSizeChange,
  hasPrevious,
  hasNext,
  onFirst,
  onPrevious,
  onNext,
  busy = false,
  className,
}: CursorPaginationProps) {
  const t = useTranslations("pagination");
  /* 总页数是**算得出来**的:`total` 与 `pageSize` 都在手上。跳不了任意页是游标的限制，
     但那不等于连自己在第几页都说不出——不说的话，翻到第七页时只知道「还有下一页」。 */
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-sm ${className ?? ""}`}
    >
      <span className="flex flex-wrap items-center gap-sm text-body-sm text-muted-foreground tabular-nums">
        <span>{t("total", { total })}</span>
        <span>{t("position", { page, pageCount })}</span>
      </span>
      <div className="flex items-center gap-sm">
        <label className="flex items-center gap-2xs text-body-sm text-muted-foreground">
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
        {/* 「首页」与「上一页」的禁用条件相同（都要求不在第一页），但它们不是一件事:
            翻到第 30 页想回头看，点 29 次上一页不是一个可用的答案。 */}
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPrevious || busy}
          onClick={onFirst}
        >
          {t("first")}
        </Button>
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
