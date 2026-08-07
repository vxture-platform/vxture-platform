/**
 * Table.tsx - 表格原语族。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Display
 *
 * 结构照 shadcn 官方 Table，视觉语法对齐本仓 DataTable 的透明模式（workplan
 * §1 V5）：不套容器卡，表头下实线开区块、行间虚线分行，首末列内边距归零让
 * 文字与上下文左右缘对齐。与 DataTable 的分工：那件管三态 / 排序 / 选择的
 * 完整骨架，本族只管 markup——列结构不规则、或要自己接 table 库时用这族。
 *
 * 上游给 footer 铺 `bg-muted/50`，透明模式下改为虚线上边框——同一条规则在
 * DataTable 的 footer 槽位也是这么画的。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { hairline } from "../../../styles/recipes";

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {}

export interface TableSectionProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {}

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {}

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {}

export interface TableCaptionProps extends React.HTMLAttributes<HTMLTableCaptionElement> {}

const Table = React.forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, ...props },
  ref,
) {
  return (
    // 横向滚动关在自己这层，不让宽表把整页撑出滚动条。
    <div className="relative w-full overflow-x-auto">
      <table
        ref={ref}
        className={cn(
          "w-full caption-bottom border-collapse text-body-sm",
          className,
        )}
        {...props}
      />
    </div>
  );
});

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  TableSectionProps
>(function TableHeader({ className, ...props }, ref) {
  return (
    <thead
      ref={ref}
      className={cn(
        "border-b",
        hairline.block,
        "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
});

const TableBody = React.forwardRef<HTMLTableSectionElement, TableSectionProps>(
  function TableBody({ className, ...props }, ref) {
    return (
      <tbody
        ref={ref}
        className={cn("[&_tr:last-child]:border-0", className)}
        {...props}
      />
    );
  },
);

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  TableSectionProps
>(function TableFooter({ className, ...props }, ref) {
  return (
    <tfoot
      ref={ref}
      className={cn(
        "border-t",
        hairline.field,
        "font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
});

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  function TableRow({ className, ...props }, ref) {
    return (
      <tr
        ref={ref}
        className={cn(
          "border-b",
          hairline.field,
          "transition-colors duration-fast ease-standard hover:bg-accent",
          // ⚠ 选中态是 `data-state="selected"`（调用方或 table 库设置），
          //   必须写 `data-[state=selected]`，`data-selected:` 匹配不上。
          "data-[state=selected]:bg-surface-selected",
          className,
        )}
        {...props}
      />
    );
  },
);

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  function TableHead({ className, ...props }, ref) {
    return (
      <th
        ref={ref}
        className={cn(
          "whitespace-nowrap px-md py-sm text-left align-middle text-label-sm",
          "first:pl-none last:pr-none",
          className,
        )}
        {...props}
      />
    );
  },
);

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  function TableCell({ className, ...props }, ref) {
    return (
      <td
        ref={ref}
        className={cn(
          "px-md py-md align-middle text-foreground",
          "first:pl-none last:pr-none",
          className,
        )}
        {...props}
      />
    );
  },
);

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  TableCaptionProps
>(function TableCaption({ className, ...props }, ref) {
  return (
    <caption
      ref={ref}
      className={cn("mt-md text-body-sm text-muted-foreground", className)}
      {...props}
    />
  );
});

Table.displayName = "Table";
TableHeader.displayName = "TableHeader";
TableBody.displayName = "TableBody";
TableFooter.displayName = "TableFooter";
TableRow.displayName = "TableRow";
TableHead.displayName = "TableHead";
TableCell.displayName = "TableCell";
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
