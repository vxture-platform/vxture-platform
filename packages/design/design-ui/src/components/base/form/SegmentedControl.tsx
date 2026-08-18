/**
 * SegmentedControl.tsx - 一组互斥选项，选中项就地高亮。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 取代 `PageSizePicker` 与 `ViewModeSwitch`——两者形状完全相同（一串按钮、一个选中），
 * 只是一个装数字、一个装图标。合成一件后"每页条数"与"列表/卡片"分别退回调用方的
 * 一行 items。
 *
 * 语义用 radiogroup 而非 group：这是单选，键盘用户应当能用方向键在选项间移动。
 * 选中态由本件画（托起的底色片），不再靠调用方挂 `.is-active`——那个类随遗留样式层
 * 一并删除后，两件的选中态实际已经不可见。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { interactive } from "../../../styles/recipes";
import { Icon, type IconName } from "../../../icons";

export type SegmentedControlSize = "sm" | "md";

/**
 * 高度挂在**容器**上、分段 `h-full` 撑满，而不是给每个分段定高再靠容器内边距
 * 撑开。后者会让控件的实际高度变成"分段高 + 2×内边距"这样一个算出来的数
 * （sm 档 28+8=36px），跟同处一行的 Button（`size="sm"` = 32px）与
 * NativeSelect（32px）永远差几个像素，排在一起参差不齐。定在容器上之后，
 * `h-control-*` 是多少，控件就是多少。
 */
const BY_SIZE: Record<SegmentedControlSize, { root: string; item: string }> = {
  // 两档都用 label-sm。档位在这里只决定**高度**，不连带改字号——md 档原先用
  // label-md（= text-sm），比同尺寸 NativeSelect 的 text-body-sm（= text-xs）
  // 大一号，两个控件上下排在同一栏里字号明显不一致。控件里的选项文字是标签
  // 不是正文，不该比它旁边的下拉更抢眼。
  sm: { root: "h-control-sm", item: "min-w-control-sm px-xs text-label-sm" },
  md: { root: "h-control-md", item: "min-w-control-md px-sm text-label-sm" },
};

export interface SegmentedControlItem<TValue extends string | number> {
  readonly value: TValue;
  readonly label?: React.ReactNode;
  readonly icon?: IconName;
  /** 只有图标时必须给，否则读屏没有可念的名字。 */
  readonly ariaLabel?: string;
  /** 该档的条数，渲染成标签后的小徽标。 */
  readonly count?: number;
  readonly disabled?: boolean;
}

export interface SegmentedControlProps<TValue extends string | number> {
  readonly items: readonly SegmentedControlItem<TValue>[];
  readonly value: TValue;
  readonly onChange: (value: TValue) => void;
  readonly size?: SegmentedControlSize;
  /**
   * 撑满可用宽度，各分段等宽。默认 false（宽度随内容），适合工具条里跟别的
   * 控件并排；表单里独占一行时置 true，否则控件缩在左边、右侧留一大片空白，
   * 与同栏的输入框/下拉右边缘对不齐。
   */
  readonly fill?: boolean;
  readonly ariaLabel?: string;
  readonly className?: string;
}

function SegmentedControl<TValue extends string | number>({
  items,
  value,
  onChange,
  size = "md",
  fill = false,
  ariaLabel,
  className,
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="radiogroup"
      {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
      className={cn(
        // 形态是"槽 + 滑块"：外层是一条中性灰的**凹槽**（bg-muted + 一条淡
        // 描边），选中项是槽**内部**浮起的一枚滑块。因此外层要有内边距——
        // 滑块比槽矮一圈、四周留一线底色，才有"嵌在里面"的观感；分段直接顶
        // 满外框会退化成三个方格子拼接，看不出这是一个可切换的控件。
        //
        // 圆角走 lg 槽 + sm 滑块而非胶囊（2026-08-18 owner 判：向用户面板
        // 原型 vxh-seg 的方圆观感收敛，但全部走 token 不手搓）。同心圆角：
        // 滑块半径 = 槽半径 − 内边距（lg 8px − 2xs 4px = sm 4px），滑到两端
        // 时滑块的弧线与槽的弧线平行，不会戳角。
        //
        // 槽底走 surface-3（浅色档 neutral-50）而不是 muted（neutral-200）：
        // 槽只需要"这里是个凹处"的一点点暗示，muted 那一档在白卡片上已经是
        // 一块明确的灰色面，比它承载的滑块还抢眼。暗色档 surface-3 比 card
        // 亮一级，凹陷感在两个模式下都成立。
        "flex items-stretch rounded-lg border border-input bg-surface-3 p-2xs",
        fill ? "w-full" : "inline-flex",
        BY_SIZE[size].root,
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={String(item.value)}
            type="button"
            role="radio"
            aria-checked={active}
            {...(item.ariaLabel ? { "aria-label": item.ariaLabel } : {})}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex h-full items-center justify-center gap-2xs rounded-sm",
              fill && "flex-1",
              interactive,
              BY_SIZE[size].item,
              // 选中态是"浮起的面片"而不是实心品牌块（vxh-seg 收敛）：卡面底
              // + 主色文字 + 一线投影表达"托起"，品牌色只用在文字这一小面积。
              active
                ? "bg-card font-semibold text-primary shadow-xs"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {item.icon ? (
              <Icon name={item.icon} size={16} aria-hidden="true" />
            ) : null}
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  "rounded-full px-2xs text-label-sm tabular-nums",
                  // 滑块底改浅色后，徽标不再需要反白——淡主色底 + 主色字。
                  active
                    ? "bg-primary/10 text-primary"
                    : "bg-surface-2 text-muted-foreground",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
