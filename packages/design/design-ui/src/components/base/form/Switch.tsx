/**
 * Switch.tsx - 开关（shadcn 惯例）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 结构照 shadcn 官方 Switch，取值换成 T2 语义类，不加上游没有的变体。
 *
 * 原实现是 label + 原生 checkbox + .vx-switch__track 的手写件——`@radix-ui/react-switch`
 * 一直在依赖里却没被用上。改回 Radix 拿到无障碍语义（role=switch、aria-checked、
 * 键盘操作），代价是 `onChange` 换成 Radix 的 `onCheckedChange`（本仓无消费方）。
 *
 * 尺寸取图标刻度而非密度刻度：开关是定尺的图形控件，密度收紧应体现在它周围的
 * 留白上，把图形本身压小只会先丢掉可点击面积。Checkbox 同理。
 */

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../../utils/cn";
import { interactive, invalid } from "../../../styles/recipes";

export type SwitchProps = React.ComponentPropsWithoutRef<
  typeof SwitchPrimitive.Root
>;

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  function Switch({ className, ...props }, ref) {
    return (
      <SwitchPrimitive.Root
        ref={ref}
        className={cn(
          "peer group relative inline-flex h-icon-md w-icon-xl shrink-0 items-center",
          "rounded-full border border-transparent shadow-raised",
          // 同 Checkbox：外扩命中区，不占布局。
          "after:absolute after:-inset-x-lg after:-inset-y-sm",
          interactive,
          invalid,
          "disabled:cursor-not-allowed",
          "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
          "dark:data-[state=unchecked]:bg-input/80",
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "pointer-events-none block size-icon-sm rounded-full bg-background shadow-raised ring-0",
            "transition-transform duration-fast ease-standard",
            "data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-[2px]",
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);

Switch.displayName = SwitchPrimitive.Root.displayName;
