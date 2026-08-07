/**
 * HoverCard.tsx - 悬停信息卡。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Floating
 *
 * 结构照 shadcn 官方 HoverCard，取值换成 T2 语义类。与 Tooltip 的分工：
 * Tooltip 是一行辅助文字，本件是一块可以排版的预览面（用户卡、条目摘要）——
 * 只对指针设备生效，键盘 / 触屏拿不到 hover，关键信息不能只放这里。
 */

import * as React from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { cn } from "../../../utils/cn";
import { overlayMotion, panel } from "../../../styles/recipes";

export interface HoverCardProps extends React.ComponentPropsWithoutRef<
  typeof HoverCardPrimitive.Root
> {}

export interface HoverCardTriggerProps extends React.ComponentPropsWithoutRef<
  typeof HoverCardPrimitive.Trigger
> {}

export interface HoverCardContentProps extends React.ComponentPropsWithoutRef<
  typeof HoverCardPrimitive.Content
> {}

const HoverCard = HoverCardPrimitive.Root;

const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCardContent = React.forwardRef<
  HTMLDivElement,
  HoverCardContentProps
>(function HoverCardContent(
  { className, align = "center", sideOffset = 4, ...props },
  ref,
) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          // w-64 是这一枚浮层的默认宽度，属组件尺寸而非刻度——按 design-system/docs/01-usage.md §3，
          // 组件尺寸归组件自身，不进 T2。
          "z-popover w-64 p-lg outline-none",
          panel.base,
          panel.popover,
          overlayMotion,
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
});

HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;

export { HoverCard, HoverCardTrigger, HoverCardContent };
