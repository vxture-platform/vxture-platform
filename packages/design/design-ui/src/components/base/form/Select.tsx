/**
 * select.tsx - Select 组件
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Form
 */

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { expandable, interactive, invalid } from "../../../styles/recipes";
import { overlayMinWidthClass, type OverlayWidth } from "../../overlayWidth";

export interface SelectProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Root
> {}

export interface SelectValueProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Value
> {}

export interface SelectTriggerProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Trigger
> {}

export interface SelectContentProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Content
> {
  /**
   * 下拉面板的**最小**宽度挡位。选项文字长度不可预知，故是下限不是定宽；
   * `position="popper"` 时还会被触发器宽度顶起来，取两者较大的。
   */
  readonly width?: OverlayWidth;
}

export interface SelectLabelProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Label
> {}

export interface SelectItemProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Item
> {}

export interface SelectSeparatorProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Separator
> {}

export interface SelectGroupProps extends React.ComponentPropsWithoutRef<
  typeof SelectPrimitive.Group
> {}

const Select = SelectPrimitive.Root;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  function SelectTrigger({ className, children, ...props }, ref) {
    return (
      <SelectPrimitive.Trigger
        ref={ref}
        className={cn(
          // 高度与 Input 对齐到 control-lg：同一表单行里 40 配 36 是肉眼可见的不齐。
          "flex h-control-md w-full items-center justify-between gap-xs",
          "rounded-md border border-input px-sm py-2xs",
          "bg-transparent shadow-raised dark:bg-input/30",
          "text-body-lg md:text-body-md placeholder:text-muted-foreground",
          interactive,
          invalid,
          expandable,
          "disabled:cursor-not-allowed",
          "[&>span]:line-clamp-1",
          className,
        )}
        {...props}
      >
        {children}
        <SelectPrimitive.Icon asChild>
          <Icon name="chevron-down" size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
    );
  },
);

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  function SelectContent(
    { className, children, position = "popper", width = "xs", ...props },
    ref,
  ) {
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          className={cn(
            overlayMinWidthClass[width],
            "relative z-dropdown max-h-96 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className,
          )}
          position={position}
          {...props}
        >
          <SelectPrimitive.Viewport
            className={cn(
              "p-2xs",
              position === "popper" &&
                "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
            )}
          >
            {children}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  },
);

const SelectLabel = React.forwardRef<HTMLDivElement, SelectLabelProps>(
  function SelectLabel({ className, ...props }, ref) {
    return (
      <SelectPrimitive.Label
        ref={ref}
        className={cn(
          "py-xs pl-2xl pr-sm text-label-md font-semibold",
          className,
        )}
        {...props}
      />
    );
  },
);

const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  function SelectItem({ className, children, ...props }, ref) {
    return (
      <SelectPrimitive.Item
        ref={ref}
        className={cn(
          "relative flex w-full cursor-default select-none items-center rounded-sm py-xs pl-2xl pr-sm text-body-sm outline-none focus:bg-accent focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-disabled",
          className,
        )}
        {...props}
      >
        <span className="absolute left-sm flex size-icon-sm items-center justify-center">
          <SelectPrimitive.ItemIndicator>
            <Icon name="check" size={16} />
          </SelectPrimitive.ItemIndicator>
        </span>
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      </SelectPrimitive.Item>
    );
  },
);

const SelectSeparator = React.forwardRef<HTMLDivElement, SelectSeparatorProps>(
  function SelectSeparator({ className, ...props }, ref) {
    return (
      <SelectPrimitive.Separator
        ref={ref}
        className={cn("-mx-2xs my-2xs h-px bg-border", className)}
        {...props}
      />
    );
  },
);

const SelectGroup = SelectPrimitive.Group;

SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;
SelectContent.displayName = SelectPrimitive.Content.displayName;
SelectLabel.displayName = SelectPrimitive.Label.displayName;
SelectItem.displayName = SelectPrimitive.Item.displayName;
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectGroup,
};
