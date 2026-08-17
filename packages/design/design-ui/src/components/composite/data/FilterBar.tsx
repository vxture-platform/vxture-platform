/**
 * FilterBar.tsx - 列表上方的工具行。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 结构（owner 拍板 2026-08-03，三次修订 2026-08-06；2026-08-14 左段增设切面槽）：
 * 居左【{视图切换} {计数} {切面}】—【自适应留白】—居右【{搜索} {重置} {筛选组} {操作区}】。
 * 三个左段槽都是可选的：都不传时左段为空，右段照常靠右。
 *
 * 切面（`scope`）与筛选组（`children`）刻意分列两段：筛选是"在同一份数据里少看几
 * 行"，切面是"换一份数据"。混在右段那串下拉里，换轴的控件会读成又一个筛选条件，
 * 而它一动整张表的列都会变。
 * 标题与描述由 `SectionHeader` 承担——板块的标题层级只有一个来源。
 *
 * **右段顺序是契约，不是建议**：`search` / `onReset` / `children`（筛选组）/ `actions`
 * 四个槽按此顺序渲染，调用方给什么都改不了先后。此前右段只有 children 与 actions 两
 * 段自由拼，于是 22 个列表页的搜索框、重置、下拉各排各的顺序（owner 2026-08-06）。
 *
 * 重置是图标按钮而非文字按钮：它跟在搜索框后面，一个"清空"的动作不该占掉与筛选项
 * 同等的横向宽度。
 *
 * 相对原实现：删 `title` / `description`（原先自己渲染 h2，与 SectionHeader 的
 * h2 排版不一致）；`filters` 与 `children` 二选一改为只用 `children`。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { Button } from "../../base/form/Button";
import { ViewModeSwitch, type ViewModeSwitchValue } from "./ViewModeSwitch";

/** 与 `ViewModeSwitchValue` 同一个值域；保留别名是因为调用方按板块命名。 */
export type FilterBarView = ViewModeSwitchValue;

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 搜索框，右段第一位。 */
  readonly search?: React.ReactNode;
  /** 给了就出重置图标按钮，排在搜索之后、筛选组之前。 */
  readonly onReset?: () => void;
  /** 重置按钮的读屏说法，缺省"重置筛选"。 */
  readonly resetLabel?: string;
  /**
   * 右段末位的操作区：导出、新建一类作用于整个列表的动作。
   *
   * 两条约定归调用方执行，本件只管位置：导出以选中项为对象，无选中时禁用、有选中
   * 时升为主按钮；新建是主按钮，无权限时禁用，业务上没有"新建"这回事就整个不给
   * （owner 2026-08-06）。
   */
  readonly actions?: React.ReactNode;
  /** 给了才出 list/cards 视图切换（工具行最左）。 */
  readonly view?: FilterBarView;
  readonly onViewChange?: (view: FilterBarView) => void;
  /** 停用卡片档并说明原因。透传给 `ViewModeSwitch`，判据见那里。 */
  readonly cardsDisabledReason?: string;
  /** 计数：总数或"筛选后 N 条"，由调用方给成品文案或数字。 */
  readonly count?: React.ReactNode;
  /**
   * 左段末位：**这一屏在看哪一个切面**——通常是一件 `SegmentedControl`。
   *
   * 与右段的筛选组（`children`）分开，因为它们不是一回事：筛选是"在同一份数据里
   * 少看几行"，切面是"换一份数据"。把换轴的控件混进右段的一串下拉里，它会读成
   * 又一个筛选条件，而它一动整张表的列都会变。
   *
   * 放在计数之后而不是之前：先答"有多少"再答"按什么分"，与视图切换同属"这张表
   * 长什么样"的一段，一起靠左。
   */
  readonly scope?: React.ReactNode;
}

const FilterBar = React.forwardRef<HTMLDivElement, FilterBarProps>(
  function FilterBar(
    {
      className,
      search,
      onReset,
      resetLabel = "重置筛选",
      actions,
      view,
      onViewChange,
      cardsDisabledReason,
      count,
      scope,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-wrap items-center justify-between gap-md",
          className,
        )}
        {...props}
      >
        {/* 左段：视图切换 + 计数 + 切面。shrink-0 保证窄屏下先折右段不挤左段。 */}
        <div className="flex shrink-0 items-center gap-sm">
          {/* 视图切换本身是独立一件（ViewModeSwitch）：不止工具行要用，
              admin 的列表页有二十多处不经 FilterBar 直接摆一个。原先这里内联
              了一份同样的 ToggleGroup，两处各改各的就会分叉。 */}
          {view && onViewChange ? (
            <ViewModeSwitch
              value={view}
              onChange={onViewChange}
              {...(cardsDisabledReason ? { cardsDisabledReason } : {})}
            />
          ) : null}
          {count !== undefined ? (
            <span className="whitespace-nowrap text-label-md text-muted-foreground">
              {count}
            </span>
          ) : null}
          {scope}
        </div>
        {/* 右段：搜索 → 重置 → 筛选组 → 操作区，一起靠右；中间由 justify-between 留白。 */}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-sm">
          {search}
          {onReset ? (
            <Button
              variant="outline"
              size="icon-md"
              onClick={onReset}
              aria-label={resetLabel}
              title={resetLabel}
            >
              {/* 回转箭头，不是叉：叉是"关掉"，这里做的是"复位"。 */}
              <Icon name="undo" size="sm" aria-hidden="true" />
            </Button>
          ) : null}
          {children}
          {actions}
        </div>
      </div>
    );
  },
);

FilterBar.displayName = "FilterBar";

export { FilterBar };
