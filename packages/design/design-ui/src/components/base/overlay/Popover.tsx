/**
 * Popover.tsx - 气泡浮层。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Floating
 */

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../../../utils/cn";
import { overlayMotion, panel } from "../../../styles/recipes";
import { overlayWidthClass, type OverlayWidth } from "../../overlayWidth";

export interface PopoverProps extends React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Root
> {}

export interface PopoverTriggerProps extends React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Trigger
> {}

export interface PopoverContentProps extends React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> {
  /**
   * 气泡宽度挡位。这里是**定宽**而非下限：气泡里是排版好的一段内容，
   * 宽度由设计决定，不该随内容浮动（菜单类相反，见 [overlayWidth.ts]）。
   */
  readonly width?: OverlayWidth;
}

export interface PopoverCloseProps extends React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Close
> {}

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;
/**
 * 定位锚点，与触发器解耦。用在"浮层的开合由别的东西决定、但要贴着某个元素
 * 定位"的场合——典型是行内搜索：输入框本身不是触发器（点它要落焦点、不是
 * 开浮层），结果面板由"有没有输入"决定开合，位置贴着输入框。
 */
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<HTMLDivElement, PopoverContentProps>(
  function PopoverContent(
    { className, align = "center", sideOffset = 4, width = "lg", ...props },
    ref,
  ) {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          className={cn(
            // 默认档 lg = 18rem。挡位是按设计定的（见 semantic-policy 的 OVERLAY_WIDTHS），
            // 与原先写死的 w-72 同值属巧合——不是拿那个手调值倒推出来的。
            // 原注说"属组件尺寸而非刻度、不进 T2"是把 01-usage.md §3 读反了：§3 说
            // **上下文尺寸由 cva variant 承载**，而它给的例子恰是 h-control-md——
            // 变体归组件，取值仍来自 T2。现在 T2 有了 --container-overlay-*，这里照 §3 办。
            overlayWidthClass[width],
            "z-popover p-lg outline-none",
            panel.base,
            panel.popover,
            overlayMotion,
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  },
);

PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverTrigger, PopoverContent, PopoverClose };
