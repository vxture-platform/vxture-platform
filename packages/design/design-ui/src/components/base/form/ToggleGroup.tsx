/**
 * ToggleGroup.tsx - 双态按钮组。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Form
 *
 * 结构照 shadcn 官方 ToggleGroup：variant / size 定在 Root、经 context 下发给
 * 每个 Item——组内混搭两种外观没有任何正当场景，这条继承机制承自上游。
 * Item 的样式函数直接引 Toggle 的 `toggleVariants`，两件永远同步。
 *
 * 与 SegmentedControl 的分工：那件是单选的视图切换（radiogroup 语义、托盘底），
 * 本件是可多选 / 可全不选的格式开关组（如加粗+斜体），语义与形状都不同。
 */

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { type VariantProps } from "class-variance-authority";
import { cn } from "../../../utils/cn";
import { toggleVariants } from "./Toggle";

export type ToggleGroupProps = React.ComponentPropsWithoutRef<
  typeof ToggleGroupPrimitive.Root
> &
  VariantProps<typeof toggleVariants>;

export type ToggleGroupItemProps = React.ComponentPropsWithoutRef<
  typeof ToggleGroupPrimitive.Item
> &
  VariantProps<typeof toggleVariants>;

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  variant: "default",
  size: "md",
});

const ToggleGroup = React.forwardRef<HTMLDivElement, ToggleGroupProps>(
  function ToggleGroup({ className, variant, size, children, ...props }, ref) {
    return (
      <ToggleGroupPrimitive.Root
        ref={ref}
        className={cn("flex items-center justify-center gap-2xs", className)}
        {...props}
      >
        <ToggleGroupContext.Provider value={{ variant, size }}>
          {children}
        </ToggleGroupContext.Provider>
      </ToggleGroupPrimitive.Root>
    );
  },
);

const ToggleGroupItem = React.forwardRef<
  HTMLButtonElement,
  ToggleGroupItemProps
>(function ToggleGroupItem(
  { className, variant, size, children, ...props },
  ref,
) {
  const context = React.useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        toggleVariants({
          variant: context.variant ?? variant,
          size: context.size ?? size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
});

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };
