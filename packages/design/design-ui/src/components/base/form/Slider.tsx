/**
 * Slider.tsx - 滑杆。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Form
 *
 * 结构照 shadcn 官方 Slider，取值换成 T2 语义类。轨道语法对齐 TokenCounter /
 * Progress（`bg-accent` 轨道 + `rounded-4xl`），拇指尺寸取图标刻度——同 Switch
 * 的判断：定尺图形控件不跟密度缩小。禁用态压暗挂在 Root 的 `data-disabled` 上，
 * 拇指的焦点环与禁用指针拦截由 `interactive` 配方提供。
 */

import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "../../../utils/cn";
import { interactive } from "../../../styles/recipes";

export interface SliderProps extends React.ComponentPropsWithoutRef<
  typeof SliderPrimitive.Root
> {}

const Slider = React.forwardRef<HTMLSpanElement, SliderProps>(function Slider(
  { className, ...props },
  ref,
) {
  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        "data-disabled:pointer-events-none data-disabled:opacity-disabled",
        "data-[orientation=vertical]:h-media-md data-[orientation=vertical]:w-auto",
        "data-[orientation=vertical]:flex-col",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative h-2xs w-full grow overflow-hidden rounded-4xl bg-accent",
          "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2xs",
        )}
      >
        <SliderPrimitive.Range
          className={cn(
            "absolute h-full bg-primary",
            "data-[orientation=vertical]:h-auto data-[orientation=vertical]:w-full",
          )}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          "block size-icon-sm shrink-0 rounded-full",
          "border border-primary bg-background shadow-raised",
          interactive,
        )}
      />
    </SliderPrimitive.Root>
  );
});

Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
