/**
 * ButtonGroup.tsx - 相连按钮组（shadcn 惯例）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 与 SegmentedControl 的分工：**SegmentedControl 是单选语义（选哪个视图），
 * ButtonGroup 是动作并排（分裂按钮、工具条）**——形状相近，语义两回事。
 *
 * 拼接手法承上游：子件圆角在接缝处清零、`-ml-px` 叠掉双描边、聚焦时 `z-10`
 * 抬起让焦点环完整——1px 与 z-10 都在 T2 管辖之外（描边叠合是结构常量，
 * z 0–99 归局部堆叠自由使用，见 04 §8）。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";

/** 方向档的**运行时数组**，类型由它推导。预览面遍历全部档位时引这里。 */
export const BUTTON_GROUP_ORIENTATIONS = ["horizontal", "vertical"] as const;

export type ButtonGroupOrientation = (typeof BUTTON_GROUP_ORIENTATIONS)[number];

const ORIENTATION_CLASS: Record<ButtonGroupOrientation, string> = {
  horizontal: cn(
    "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:-ml-px",
    "[&>*:not(:last-child)]:rounded-r-none",
  ),
  vertical: cn(
    "flex-col",
    "[&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:-mt-px",
    "[&>*:not(:last-child)]:rounded-b-none",
  ),
};

export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly orientation?: ButtonGroupOrientation;
}

export function ButtonGroup({
  orientation = "horizontal",
  className,
  ...props
}: ButtonGroupProps) {
  return (
    <div
      role="group"
      data-slot="button-group"
      className={cn(
        "isolate flex w-fit items-stretch",
        "[&>*]:focus-visible:z-10",
        ORIENTATION_CLASS[orientation],
        className,
      )}
      {...props}
    />
  );
}

/**
 * 组内的非按钮成员（前后缀文字、计数）。给它按钮的框身但不给交互态，
 * 与两侧按钮同高同边。
 */
export function ButtonGroupText({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="button-group-text"
      className={cn(
        "flex items-center gap-2xs rounded-md border border-input",
        "bg-muted px-sm text-label-md text-muted-foreground",
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-icon-sm",
        className,
      )}
      {...props}
    />
  );
}
