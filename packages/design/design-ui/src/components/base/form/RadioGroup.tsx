/**
 * RadioGroup.tsx - 单选组。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Form
 *
 * 结构照 shadcn 官方 RadioGroup，取值换成 T2 语义类。外圈尺寸取图标刻度
 * （同 Checkbox 的判断）：定尺图形控件不跟密度缩小，密度收紧体现在周围留白。
 *
 * 指示点不走图标：本仓图标字典没有 circle，而一个纯色圆点本来就不需要字体级
 * 图标来画——一个 `rounded-full` 的 span 语义更直白，也少一次字典扩容。
 */

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "../../../utils/cn";
import { interactive, invalid } from "../../../styles/recipes";

export interface RadioGroupProps extends React.ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Root
> {}

export interface RadioGroupItemProps extends React.ComponentPropsWithoutRef<
  typeof RadioGroupPrimitive.Item
> {}

const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  function RadioGroup({ className, ...props }, ref) {
    return (
      <RadioGroupPrimitive.Root
        ref={ref}
        className={cn("grid gap-sm", className)}
        {...props}
      />
    );
  },
);

const RadioGroupItem = React.forwardRef<HTMLButtonElement, RadioGroupItemProps>(
  function RadioGroupItem({ className, ...props }, ref) {
    return (
      <RadioGroupPrimitive.Item
        ref={ref}
        className={cn(
          "peer relative aspect-square size-icon-sm shrink-0",
          "rounded-full border border-input bg-transparent text-primary shadow-raised dark:bg-input/30",
          // 同 Checkbox：命中区外扩，不占布局。
          "after:absolute after:-inset-x-lg after:-inset-y-sm",
          interactive,
          invalid,
          "disabled:cursor-not-allowed",
          // ⚠ `data-[state=checked]` 而非 `data-checked`：Radix 发的是 data-state。
          "data-[state=checked]:border-primary",
          className,
        )}
        {...props}
      >
        <RadioGroupPrimitive.Indicator className="relative flex size-full items-center justify-center">
          <span className="size-xs rounded-full bg-primary" />
        </RadioGroupPrimitive.Indicator>
      </RadioGroupPrimitive.Item>
    );
  },
);

RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
