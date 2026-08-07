/**
 * Pagination.tsx - 分页（自有实现，非 shadcn 上游件）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Navigation
 *
 * 上游 Pagination 是一组基于 <a href> 的组合件，面向 URL 驱动的分页；工作台里的
 * 分页全是受控回调（`page` + `onPageChange`，配合客户端筛选与 pageSize），两者
 * 的取数模型不同，不是同一个东西。故保留受控 API，只把取值换成 T2 语义类。
 *
 * 视觉基座仍是本仓 Button——分页按钮与页面其他按钮的尺寸、焦点环、禁用态由此
 * 自动一致，不另起一套。
 *
 * 原实现挂了 .vx-pagination（随遗留样式层退役），且间距与字号用的是不跟随
 * 密度 / 字号三档的裸数值。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { Button } from "../form/Button";
import { SegmentedControl } from "../form/SegmentedControl";

/** 每页条数的取值："auto" = 自适应（由调用方按可视高度解析成实际行数）。 */
export type PageSizeChoice = number | "auto";

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  readonly page: number;
  readonly pageCount: number;
  readonly total?: number;
  /** 筛选后的条数：与 `total` 不同时，左侧计数语补"当前筛选 N 条"。 */
  readonly filteredTotal?: number;
  /** 当前选中的档（不是解析后的行数——"auto" 档就传 "auto"）。 */
  readonly pageSize?: PageSizeChoice;
  /** 给了 `onPageSizeChange` 才出每页条数选择器（翻页条左邻）。 */
  readonly pageSizeOptions?: readonly PageSizeChoice[];
  readonly onPageSizeChange?: (pageSize: PageSizeChoice) => void;
  readonly onPageChange: (page: number) => void;
  /**
   * 覆盖左侧计数语。
   *
   * 默认那句「共 N 条记录」覆盖了绝大多数列表，口子只为它说不了的情形留：数的
   * 不是一样东西时（admin 服务套餐页要同时报"N 个方案、M 个套餐"），`total` 与
   * `filteredTotal` 都表达不了。
   */
  readonly countLabel?: React.ReactNode;
  readonly previousLabel?: string;
  readonly nextLabel?: string;
}

const DEFAULT_PAGE_SIZES: readonly PageSizeChoice[] = ["auto", 10, 20, 50, 100];

function getVisiblePages(page: number, pageCount: number) {
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const end = Math.min(pageCount, start + 4);
  return Array.from(
    { length: Math.max(0, end - start + 1) },
    (_, index) => start + index,
  );
}

function Pagination({
  className,
  page,
  pageCount,
  total,
  filteredTotal,
  pageSize,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  onPageSizeChange,
  onPageChange,
  countLabel,
  previousLabel = "上一页",
  nextLabel = "下一页",
  ...props
}: PaginationProps) {
  const safePageCount = Math.max(1, pageCount);
  const safePage = Math.min(Math.max(1, page), safePageCount);
  const pages = getVisiblePages(safePage, safePageCount);

  return (
    <nav
      className={cn(
        "flex flex-wrap items-center justify-between gap-sm",
        className,
      )}
      aria-label="Pagination"
      {...props}
    >
      {/* 左侧计数语（admin 翻页惯例）：总数常驻，筛选生效时补一段。 */}
      <div className="text-body-sm text-muted-foreground">
        {countLabel ??
          (typeof total === "number"
            ? `共 ${total} 条记录${
                typeof filteredTotal === "number" && filteredTotal !== total
                  ? ` / 当前筛选 ${filteredTotal} 条`
                  : ""
              }`
            : `第 ${safePage} / ${safePageCount} 页`)}
      </div>
      {/* 每页条数与翻页条之间留大距（gap-2xl）：两组都是数字按钮，贴近了
          会读成同一排页码。 */}
      <div className="flex flex-wrap items-center gap-2xl">
        {onPageSizeChange && pageSize !== undefined ? (
          /* 按钮化的每页条数（承旧 PageSizePicker，载体为 SegmentedControl）：
             纯数字、不带标签文字——档位一眼即懂；语义留给 aria-label。
             "auto" 档=自适应，实际行数由调用方按可视高度解析。 */
          <SegmentedControl
            /* md(32) 而不是 sm(28)：它与右侧翻页按钮同处一行，翻页按钮是
               control-md。差 4px 时两组数字按钮的基线对不齐，一眼能看出来
               （2026-08-04 opera/atlas/router 实测）。 */
            size="md"
            ariaLabel="每页条数"
            value={pageSize}
            onChange={onPageSizeChange}
            items={pageSizeOptions.map((option) => ({
              value: option,
              // "auto" 档中英文一律显示 "auto"（owner 定，2026-08-03）。
              label: option === "auto" ? "auto" : option,
              ariaLabel:
                option === "auto" ? "每页条数自适应" : `每页 ${option} 条`,
            }))}
          />
        ) : null}
        <div className="flex items-center gap-2xs">
          <Button
            variant="outline"
            size="md"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
          >
            <Icon name="chevron-left" size={16} aria-hidden="true" />
            {previousLabel}
          </Button>
          {pages.map((item) => (
            <Button
              key={item}
              variant={item === safePage ? "default" : "ghost"}
              size="md"
              aria-current={item === safePage ? "page" : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ))}
          <Button
            variant="outline"
            size="md"
            disabled={safePage >= safePageCount}
            onClick={() => onPageChange(safePage + 1)}
          >
            {nextLabel}
            <Icon name="chevron-right" size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  );
}

export { Pagination };
