/**
 * ListPagination.tsx - admin 列表页的分页条：DS `Pagination` + admin 的档位集。
 * @package @vxture/admin
 * @layer Presentation
 * @category Modules - Shared
 *
 * 十三个列表页各写了一遍"总数 + 每页条数 + 翻页器"的页脚（`Pagination` 五份裸名
 * 加 `TenantPagination` / `ProductPagination` / `AccountPagination` 等八份带前缀），
 * 结构逐字相同。
 *
 * **这三件事 DS 的 `Pagination` 全都自带**——它的注释写着「左侧计数语（admin 翻页
 * 惯例）」与「承旧 PageSizePicker，载体为 SegmentedControl」，也就是说它本来就是照
 * admin 这个页脚抽出去的，admin 自己没回接而已（`MetricCard` 同款情况）。
 *
 * 所以本件只做 DS 说不了的两件事，不重画版式：
 *
 * 1. **档位集**：DS 默认档含 `"auto"`（由调用方按可视高度解析成行数）。admin 的列表
 *    是定长分页，没有自适应档，传固定的 10/20/50/100。
 * 2. **类型窄化**：DS 的 `PageSizeChoice` 是 `number | "auto"`，admin 的 `PageSize`
 *    是那四个字面量。窄化写在这里一次，好过十三个调用点各写一次断言。
 *
 * 计数语交回 DS 默认的「共 N 条记录」。此前五个页面各自写着"条订单记录"/"条账单
 * 记录"这类业务词——人在订单页看"共 N 条记录"不会误解，那点差别不值得为它开口子。
 * 真说不了的是服务套餐页（要数方案与套餐两样东西），那处用 `countLabel`。
 */

import type { ReactNode } from "react";
import { Pagination, type PageSizeChoice } from "@vxture/design-system";
import {
  PAGE_SIZE_OPTIONS,
  type PageSize,
} from "@/modules/shared/PageSizePicker";

/** admin 的档位集：DS 默认档带 "auto"，定长分页用不上。 */
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
  return (
    <Pagination
      page={currentPage}
      pageCount={pageCount}
      {...(total !== undefined ? { total } : {})}
      pageSize={pageSize}
      pageSizeOptions={OPTIONS}
      // DS 的档位含 "auto"；这里的档位集里没有，收窄回 admin 的 PageSize。
      onPageSizeChange={(value) => onPageSizeChange(value as PageSize)}
      onPageChange={onPageChange}
      {...(countLabel !== undefined ? { countLabel } : {})}
    />
  );
}
