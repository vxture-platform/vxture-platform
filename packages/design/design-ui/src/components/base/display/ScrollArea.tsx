/**
 * ScrollArea.tsx - 自绘滚动条的滚动区。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Display
 *
 * 结构照 shadcn 官方 ScrollArea，取值换成 T2 语义类。原生滚动条在各平台宽窄
 * 不一且不跟随主题，列表 / 面板里需要一条安静的滚动条时用它。
 *
 * 一处刻意省略：上游 Viewport 挂 `rounded-[inherit]`——任意值语法在本仓被禁，
 * 圆角裁切交给调用方在 Root 上配 `overflow-hidden` + 圆角档解决（Root 已带
 * overflow-hidden，语义上就是裁切容器）。
 */

import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "../../../utils/cn";

export interface ScrollAreaProps extends React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.Root
> {}

export interface ScrollBarProps extends React.ComponentPropsWithoutRef<
  typeof ScrollAreaPrimitive.ScrollAreaScrollbar
> {}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  function ScrollArea({ className, children, ...props }, ref) {
    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        className={cn("relative overflow-hidden", className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport className="size-full">
          {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    );
  },
);

const ScrollBar = React.forwardRef<HTMLDivElement, ScrollBarProps>(
  function ScrollBar({ className, orientation = "vertical", ...props }, ref) {
    return (
      <ScrollAreaPrimitive.ScrollAreaScrollbar
        ref={ref}
        orientation={orientation}
        className={cn(
          "flex touch-none select-none p-px transition-colors",
          // 轨道宽取 sm 档（默认密度 10px），与上游 w-2.5 同值但跟随密度轴。
          orientation === "vertical" &&
            "h-full w-sm border-l border-l-transparent",
          orientation === "horizontal" &&
            "h-sm flex-col border-t border-t-transparent",
          className,
        )}
        {...props}
      >
        <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
      </ScrollAreaPrimitive.ScrollAreaScrollbar>
    );
  },
);

ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
