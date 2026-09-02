"use client";

/**
 * ListPagination.tsx — opera 列表页分页条:DS `Pagination` + next-intl 文案。
 * @package @vxture/opera
 * @layer Presentation
 * @category Modules - Shared
 *
 * 表格体系统一(2026-09-02):DS `Pagination` 面向用户的文案全是英文装机默认,i18n 由消费方
 * 传入(DS 的 labels-props 契约)。opera 此前各页直接用 `<Pagination>` 且不传 label,整条分页
 * 显英文。本件统一从 next-intl 顶层 `pagination` 命名空间喂入全部文案,与 admin/arche 一致。
 *
 * 页大小固定为 10/20/50/100（无 "auto" 自适应档，与 admin 一致——owner 2026-09-02 定，
 * 三平面统一去 auto）。`pageSize` 类型仍收 DS 的 `PageSizeChoice` 以对接 `useListPagination`
 * 的取值，但选择器只呈现定长档。
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Pagination, type PageSizeChoice } from "@vxture/design-system";

/** 定长页大小档（无 auto），与 admin PAGE_SIZE_OPTIONS 一致。 */
const PAGE_SIZE_OPTIONS: readonly PageSizeChoice[] = [10, 20, 50, 100];

export interface ListPaginationProps {
  readonly currentPage: number;
  readonly pageCount: number;
  /** 记录总数。给了 `countLabel` 时可省。 */
  readonly total?: number;
  /** 筛选后条数：与 total 不同时 DS 计数语补一段(此处交给 DS 默认拼；给了 countLabel 则不补)。 */
  readonly filteredTotal?: number;
  readonly pageSize?: PageSizeChoice;
  readonly onPageSizeChange?: (value: PageSizeChoice) => void;
  readonly onPageChange: (page: number) => void;
  /** 覆盖左侧计数语（DS 默认「共 N 条」说不了的多数场景，如两个数）。 */
  readonly countLabel?: ReactNode;
  readonly className?: string;
}

export function ListPagination({
  currentPage,
  pageCount,
  total,
  filteredTotal,
  pageSize,
  onPageSizeChange,
  onPageChange,
  countLabel,
  className,
}: ListPaginationProps) {
  const t = useTranslations("pagination");
  const resolvedCountLabel =
    countLabel ?? (total !== undefined ? t("total", { total }) : undefined);

  return (
    <Pagination
      {...(className !== undefined ? { className } : {})}
      page={currentPage}
      pageCount={pageCount}
      {...(total !== undefined ? { total } : {})}
      {...(filteredTotal !== undefined ? { filteredTotal } : {})}
      {...(pageSize !== undefined ? { pageSize } : {})}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      {...(onPageSizeChange !== undefined ? { onPageSizeChange } : {})}
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
