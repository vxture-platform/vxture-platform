"use client";

/**
 * ListPagination.tsx — console 列表页的分页条:DS `Pagination` + console 的档位集。
 * @package @vxture/console
 * @layer Presentation
 * @category Components
 *
 * admin / opera / arche 三面 2026-09-02 就统一走各自的 `ListPagination` 收口了,
 * console 漏在外面:成员管理页直接用 DS `Pagination`,于是拿到 DS 的**装机默认**——
 * 档位含 `"auto"`(自适应,由调用方按可视高度解析成行数),计数语是英文
 * `"N records"`,每页条数的读屏名也是英文。三处都是漏传,不是设计。
 *
 * 本件只做 DS 说不了的两件事,不重画版式:
 *
 * 1. **档位集**:console 的列表是定长分页,没有自适应档,传固定的 10/20/50/100
 *    (与另外三面同一串)。用它的页面别忘了把 `useListPagination` 的初始档从
 *    默认的 `"auto"` 改成其中一个——档位集里没有的值,分段控件选不中。
 * 2. **文案**:DS 的面向用户文案全是英文装机默认(DS 零语言假设,托底只为漏传时
 *    仍可读),这里统一从 `pagination` 命名空间喂入,与另外三面一字不差。
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Pagination, type PageSizeChoice } from "@vxture/design-system";

/** console 的档位集:DS 默认档带 "auto",定长分页用不上。 */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const OPTIONS: readonly PageSizeChoice[] = PAGE_SIZE_OPTIONS;

export interface ListPaginationProps {
  readonly page: number;
  readonly pageCount: number;
  /** 记录总数。给了 `countLabel` 时可省。 */
  readonly total?: number;
  /** 筛选后的条数:与 `total` 不同时,计数语补一句「当前筛选 N 条」。 */
  readonly filteredTotal?: number;
  readonly pageSize: PageSizeChoice;
  readonly onPageSizeChange: (value: PageSize) => void;
  readonly onPageChange: (page: number) => void;
  /** 覆盖左侧计数语。只在「共 N 条」说不了时给。 */
  readonly countLabel?: ReactNode;
}

export function ListPagination({
  page,
  pageCount,
  total,
  filteredTotal,
  pageSize,
  onPageSizeChange,
  onPageChange,
  countLabel,
}: ListPaginationProps) {
  const t = useTranslations("pagination");
  const resolvedCountLabel =
    countLabel ??
    (total !== undefined
      ? filteredTotal !== undefined && filteredTotal !== total
        ? t("totalFiltered", { total, filtered: filteredTotal })
        : t("total", { total })
      : undefined);

  return (
    <Pagination
      className="w-full"
      page={page}
      pageCount={pageCount}
      {...(total !== undefined ? { total } : {})}
      pageSize={pageSize}
      pageSizeOptions={OPTIONS}
      // 档位集里没有 "auto",回调只会给出上面那四个数;收窄回 console 的 PageSize。
      onPageSizeChange={(value) => onPageSizeChange(value as PageSize)}
      onPageChange={onPageChange}
      previousLabel={t("previous")}
      nextLabel={t("next")}
      pageSizeLabel={t("pageSizeLabel")}
      pageSizeOptionTemplate={t("pageSizeOption")}
      {...(resolvedCountLabel !== undefined
        ? { countLabel: resolvedCountLabel }
        : {})}
    />
  );
}
