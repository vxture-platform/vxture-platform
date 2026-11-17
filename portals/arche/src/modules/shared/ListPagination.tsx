/**
 * Fixed-size list pagination using the shared DS component and platform labels.
 * @package @vxture/arche
 * @layer Presentation
 * @category Modules - Shared
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Pagination, type PageSizeChoice } from "@vxture/design-system";
import {
  PAGE_SIZE_OPTIONS,
  type PageSize,
} from "@/modules/shared/PageSizePicker";

/** Fixed page sizes match the platform list contract. */
const OPTIONS: readonly PageSizeChoice[] = PAGE_SIZE_OPTIONS;

export interface ListPaginationProps {
  readonly currentPage: number;
  readonly pageCount: number;
  /** 记录总数。给了 `countLabel` 时可省。 */
  readonly total?: number;
  readonly pageSize: PageSize;
  readonly onPageSizeChange: (value: PageSize) => void;
  readonly onPageChange: (page: number) => void;
  /**
   * 覆盖左侧计数语。只在 DS 那句「共 N 条记录」说不了时给——目前仅服务套餐页
   * （"共 N 个方案，M 个套餐"，两个数）。
   */
  readonly countLabel?: ReactNode;
}

export function ListPagination({
  currentPage,
  pageCount,
  total,
  pageSize,
  onPageSizeChange,
  onPageChange,
  countLabel,
}: ListPaginationProps) {
  // DS Pagination 文案全是英文装机默认,i18n 由消费方传入(DS labels-props 契约)。统一从
  // next-intl 的 `pagination` 命名空间喂入,三平面一致。计数语默认「共 N 条」;countLabel 优先。
  const t = useTranslations("pagination");
  const resolvedCountLabel =
    countLabel ?? (total !== undefined ? t("total", { total }) : undefined);

  return (
    <Pagination
      page={currentPage}
      pageCount={pageCount}
      {...(total !== undefined ? { total } : {})}
      pageSize={pageSize}
      pageSizeOptions={OPTIONS}
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
