/**
 * DataTable.tsx - 表格骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 列由 `columns` 描述，单元格取值由 `cell` 回调给出——DS 不认业务字段，只认形状。
 *
 * 三态一次定齐：加载中出骨架行（保持表格高度，不让页面跳），空态出 `EmptyState`，
 * 有数据出行。原实现三者是三段各写各的 markup，加载与空态都只有一行居中文字。
 *
 * 选择态由本件出复选框，`selectedKeys` 受控——`BulkActionBar` 要的就是这个集合，
 * 两件对得上才不会各自实现一遍全选/半选。表头那个复选框的半选态必须走
 * `indeterminate`，不能靠给它换个图标。表头复选框只加减**本页**的 key，
 * 页外选中项不动（见 `toggleAll`）。
 *
 * 相对原实现：删 `className` / `headerClassName` / `cellClassName` 三个列级逃生口
 * （列的对齐由 `align` 表达，其余交给单元格内容）与 `getRowClassName`——按行改样式
 * 等于把行的视觉状态交回调用方，行选中与行禁用本件自己画。
 *
 * 透明模式（workplan §1 V5）：表格不套容器卡。它直接浮在页面底色上，结构由
 * 三条线定义——顶边实线开区块，表头下实线，行间虚线。首末列内边距归零，
 * 让表格文字与上下文的左右缘对齐（admin 的表格就是靠这个嵌进页面的）。
 * 表头与数据行共用同一个 `align` 轴——admin 表头居中、行左对齐的轴冲突（X1）
 * 在这里从结构上不可能发生。
 *
 * 列的对齐是一条**约定**，不是每张表各自决定（2026-08-05 owner 定）：
 *
 * | 列          | 宽              | 内容                          |
 * | ----------- | --------------- | ----------------------------- |
 * | 选择框      | 64px            | 居中                          |
 * | 序号        | 64px            | 居中，表头写 `#`              |
 * | 主列（图标+标题+辅助信息） | 自适应 | 居左           |
 * | 状态        | 自适应          | 居中（`align:"center"`）      |
 * | 信息列      | 自适应          | 数值右、文本左                |
 * | 操作        | 64px            | 居中，单图标                  |
 *
 * **表头一律居中，且是常规字重的正文字号**，与该列数据的 `align` 无关：列名是
 * 框架信息，不是展示重点，不该比它标注的数据更重、也不必跟着数据摆。序号列的
 * 列名写 `#`——"序号"三个字比它下面的数字还长。
 *
 * 三根固定列（选择 / 序号 / 操作）都是 `w-control-3xl`+居中，两端等宽，表格
 * 不会因为最右侧靠右对齐而在视觉上偏出去。
 *
 * 三根固定列**不**参与首末列零边距——`first:` 选择器认的是 DOM 里真实的第一个
 * `<td>`，选择列一旦存在就是它，零边距会把复选框顶到容器边界外观（2026-08-03
 * owner 实测抓到）。零边距的意图仍在：没有选择/序号列时，业务首列照常贴边
 * 对齐上下文。
 *
 * **行不表达业务语气。** 曾短暂给过 `rowTone`（行首 2px 色缘），实测很难看：
 * 一屏几十行，左缘的彩色短线读成一列断续的碎点，既不成列也不成块。业务语气
 * 由**状态列**表达——需要语气的表格约定必须有一列状态，用 `StatusBadge` 出标，
 * 那里的语气有形状、有文字、可读可筛。行只表达交互态（hover / 选中）。
 *
 * hover / 选中的底色只在**每个单元格自己**身上画一遍，`<tr>` 本体不着色。
 * `accent` / `surface-selected` 都是半透明 token（品牌色 8–15% alpha）——如果
 * `<tr>` 也画一层、锁定列再在其上画一层，两层半透明会叠加合成，锁定列的颜色
 * 会比其余单元格明显更深（2026-08-03 owner 实测抓到：同一个 token 画了两遍，
 * 不是两个不同的颜色在打架）。改法：`<tr>` 只留 `group` 作为 hover 触发源，
 * 每个 `<td>`（含锁定列）各自订阅一次 `group-hover:` / `isSelected`，全表只有
 * 一层色。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { hairline, interactive } from "../../../styles/recipes";
import { Icon } from "../../../icons";
import { Checkbox } from "../../base/form/Checkbox";
import { Skeleton } from "../../base/display/Skeleton";
import { EmptyState } from "../../base/display/EmptyState";

export type DataTableAlign = "left" | "center" | "right";

export type DataTableSortDirection = "asc" | "desc";

const ALIGN: Record<DataTableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/** 选择列 / 序号列 / 操作列共用：固定 64px、居中，不吃首末列零边距。 */
const EDGE_COL = "w-control-3xl px-md text-center";

export interface DataTableColumn<TRow> {
  readonly id: string;
  readonly header: React.ReactNode;
  readonly cell: (row: TRow, rowIndex: number) => React.ReactNode;
  /**
   * 表头与单元格共用一个轴（见文件头的对齐约定）。默认 `left`。
   * 状态列一律 `center`；数值列 `right`；其余文本列留默认。
   */
  readonly align?: DataTableAlign;
  /** 可排序。排序本身由调用方做，本件只出表头控件与方向指示。 */
  readonly sortable?: boolean;
}

export interface DataTableSort {
  readonly columnId: string;
  readonly direction: DataTableSortDirection;
}

export interface DataTableProps<TRow> {
  readonly columns: readonly DataTableColumn<TRow>[];
  readonly rows: readonly TRow[];
  readonly rowKey: (row: TRow, rowIndex: number) => string;
  readonly loading?: boolean;
  /** 加载态渲染多少条骨架行。取列表常用页长的一半即可，只为撑住高度。 */
  readonly loadingRows?: number;
  /**
   * 无数据时铺在表体里的内容，通常是一个 `EmptyState`。不传出 DS 默认空态。
   *
   * 是一个槽而不是 `emptyTitle` / `emptyDescription` / `emptyAction` 三件：本件管
   * 空态**摆在哪**，不管它长什么样——与 `footer` 同一个道理。三件式那版让本件替
   * `EmptyState` 转发参数，`EmptyState` 每加一个能力这里就要跟着加一个 props。
   */
  readonly empty?: React.ReactNode;
  readonly sort?: DataTableSort;
  readonly onSortChange?: (sort: DataTableSort) => void;
  /** 给了才出复选框列。 */
  readonly selectedKeys?: readonly string[];
  readonly onSelectionChange?: (keys: readonly string[]) => void;
  /**
   * 给了才出序号列（复选框之后、首业务列之前），值为本页首行的序号——
   * 翻页时由调用方递进（`(page-1)*pageSize+1`），本件不认分页。
   */
  readonly indexStart?: number;
  /**
   * 给了才出行操作列：固定 64px、钉在最右、横向滚动时锁定不动（admin 列锁定
   * 惯例），内容居中——放的是单个图标触发器（`ActionMenu`），不是一排按钮。
   */
  readonly rowActions?: (row: TRow, rowIndex: number) => React.ReactNode;
  /* 没有 rowTone / getRowClassName：行不表达业务语气，见文件头。 */
  /** 表尾：分页、总数一类。渲染在虚线上边框之下，左右两端由调用方内容自摆。 */
  readonly footer?: React.ReactNode;
  readonly className?: string;
}

function nextDirection(
  sort: DataTableSort | undefined,
  columnId: string,
): DataTableSortDirection {
  return sort?.columnId === columnId && sort.direction === "asc"
    ? "desc"
    : "asc";
}

function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  loading = false,
  loadingRows = 5,
  empty,
  sort,
  onSortChange,
  selectedKeys,
  onSelectionChange,
  indexStart,
  rowActions,
  footer,
  className,
}: DataTableProps<TRow>) {
  const selectable = selectedKeys !== undefined;
  const indexed = indexStart !== undefined;
  const selected = React.useMemo(
    () => new Set(selectedKeys ?? []),
    [selectedKeys],
  );
  const keys = rows.map((row, i) => rowKey(row, i));
  const allSelected = keys.length > 0 && keys.every((k) => selected.has(k));
  const someSelected = !allSelected && keys.some((k) => selected.has(k));
  const colSpan =
    columns.length +
    (selectable ? 1 : 0) +
    (indexed ? 1 : 0) +
    (rowActions ? 1 : 0);

  /**
   * 只加减本页的 key，页外的选中项原样留着——本件拿到的 `rows` 只有当前页，
   * 把整个集合替换成 `keys`（或清成 `[]`）会把用户在别页选的一并抹掉，而
   * `BulkActionBar` 消费的正是这个跨页集合。
   */
  const toggleAll = () => {
    const next = new Set(selected);
    for (const key of keys) {
      if (allSelected) next.delete(key);
      else next.add(key);
    }
    onSelectionChange?.([...next]);
  };

  const toggleRow = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange?.([...next]);
  };

  return (
    <div className={cn("border-t", hairline.block, className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <thead
            className={cn(
              "border-b",
              hairline.block,
              // 常规字重的正文字号：列名是框架信息，不该比它标注的数据更重。
              "text-body-sm font-normal text-muted-foreground",
            )}
          >
            <tr>
              {selectable ? (
                <th scope="col" className={cn(EDGE_COL, "py-sm font-normal")}>
                  <div className="flex items-center justify-center">
                    <Checkbox
                      checked={allSelected || (someSelected && "indeterminate")}
                      onCheckedChange={toggleAll}
                      aria-label={allSelected ? "取消本页全选" : "全选本页"}
                    />
                  </div>
                </th>
              ) : null}
              {indexed ? (
                <th
                  scope="col"
                  className={cn(
                    EDGE_COL,
                    "py-sm font-normal whitespace-nowrap",
                  )}
                >
                  #
                </th>
              ) : null}
              {columns.map((column) => {
                const active = sort?.columnId === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={
                      active
                        ? sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={cn(
                      "whitespace-nowrap px-md py-sm font-normal",
                      "first:pl-none last:pr-none",
                      // 表头一律居中，与列的 align 无关——align 说的是数据。
                      "text-center",
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() =>
                          onSortChange({
                            columnId: column.id,
                            direction: nextDirection(sort, column.id),
                          })
                        }
                        className={cn(
                          "inline-flex items-center gap-2xs rounded-sm",
                          interactive,
                          active ? "text-foreground" : "hover:text-foreground",
                        )}
                      >
                        {column.header}
                        <Icon
                          name={
                            active && sort.direction === "desc"
                              ? "arrow-down"
                              : "arrow-up"
                          }
                          size={16}
                          aria-hidden="true"
                          className={active ? undefined : "opacity-muted"}
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
              {rowActions ? (
                <th
                  scope="col"
                  className={cn(
                    EDGE_COL,
                    "sticky right-0 whitespace-nowrap bg-background py-sm font-normal",
                  )}
                >
                  操作
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`skeleton-${i}`} aria-hidden="true">
                  {Array.from({ length: colSpan }, (_, c) => (
                    <td
                      key={c}
                      className="px-md py-sm first:pl-none last:pr-none"
                    >
                      <Skeleton className="h-control-xs w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-lg">
                  {empty ?? <EmptyState icon="list" title="暂无数据" />}
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => {
                const key = keys[rowIndex] as string;
                const isSelected = selected.has(key);
                /* 单层色：每个 <td> 各画一次，不假手 <tr>（见文件头注）。 */
                const cellSurface = cn(
                  "transition-colors duration-fast ease-standard",
                  isSelected ? "bg-surface-selected" : "group-hover:bg-accent",
                );
                return (
                  <tr
                    key={key}
                    {...(selectable ? { "aria-selected": isSelected } : {})}
                    className={cn(
                      "group border-b last:border-b-0",
                      hairline.field,
                    )}
                  >
                    {selectable ? (
                      <td
                        className={cn(
                          EDGE_COL,
                          "py-md align-middle",
                          cellSurface,
                        )}
                      >
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(key)}
                            aria-label="选择本行"
                          />
                        </div>
                      </td>
                    ) : null}
                    {indexed ? (
                      <td
                        className={cn(
                          EDGE_COL,
                          "py-md align-middle whitespace-nowrap text-body-sm text-muted-foreground",
                          cellSurface,
                        )}
                      >
                        {indexStart + rowIndex}
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          "px-md py-md align-middle text-foreground",
                          "first:pl-none last:pr-none",
                          ALIGN[column.align ?? "left"],
                          cellSurface,
                        )}
                      >
                        {column.cell(row, rowIndex)}
                      </td>
                    ))}
                    {rowActions ? (
                      /* 锁定列自己铺底：横向滚动时业务列从其下方经过，需要
                         不透明底色遮住。背景色直接落在 td 本体上，不借内层
                         div——`<td>` 在表格布局里的盒子天然与整行同高，div 的
                         `height:100%` 在表格单元格里解析不出结果（父 td 高度
                         由内容撑出，百分比高度按 CSS 规范退回 auto，即"只随
                         内容撑高"），h-full 因此不生效：行内别的单元格更高时
                         （如两行主列），背景条矮一截，上下露出容器底色
                         （2026-08-03 owner 实测抓到，h-full 那版没修对）。
                         垂直居中交给 `align-middle`（对真实 td 有效，不受
                         百分比高度限制）；水平居中交给 EDGE_COL 的 `text-center`
                         （ActionMenu 触发按钮是 inline-flex，服从文本对齐），
                         与选择列 / 序号列同宽同轴。 */
                      <td
                        className={cn(
                          EDGE_COL,
                          "sticky right-0 whitespace-nowrap align-middle",
                          // 未选中态补一层不透明底：横向滚动时业务列从它下方
                          // 经过，需要遮住。选中态的 surface-selected 本身也是
                          // 半透明 token，遮不住滚动内容——与其余选中行同样的
                          // 已知小缺口，不在本次两个 bug 的范围内。
                          !isSelected && "bg-background",
                          cellSurface,
                        )}
                      >
                        {rowActions(row, rowIndex)}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {footer ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-sm border-t py-md",
            hairline.field,
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

export { DataTable };
