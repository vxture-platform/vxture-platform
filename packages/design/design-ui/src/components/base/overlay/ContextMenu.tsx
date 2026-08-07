/**
 * ContextMenu.tsx - 右键菜单。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Navigation
 *
 * 结构照 shadcn 官方 ContextMenu，取值换成 T2 语义类。面板与条目的画法与
 * DropdownMenu 逐类相同——两件只差触发方式（右键 vs 点击），外观分叉没有
 * 任何理由。上游条目高亮走 `data-highlighted`，这里沿 DropdownMenu 的
 * `focus:` 写法：Radix 高亮时同时给焦点，两者等效且少一族选择器。
 */

import * as React from "react";
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { cn } from "../../../utils/cn";
import { overlayMotion, panel } from "../../../styles/recipes";
import { Icon } from "../../../icons";
import { overlayMinWidthClass, type OverlayWidth } from "../../overlayWidth";

export interface ContextMenuProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Root
> {}

export interface ContextMenuTriggerProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Trigger
> {}

export interface ContextMenuContentProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Content
> {
  /**
   * 菜单面板的**最小**宽度挡位。菜单项文字长度不可预知，故是下限不是定宽。
   */
  readonly width?: OverlayWidth;
}

export interface ContextMenuItemProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Item
> {
  readonly inset?: boolean;
}

export interface ContextMenuCheckboxItemProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.CheckboxItem
> {}

export interface ContextMenuRadioItemProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.RadioItem
> {}

export interface ContextMenuLabelProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Label
> {
  readonly inset?: boolean;
}

export interface ContextMenuSeparatorProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Separator
> {}

export interface ContextMenuGroupProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Group
> {}

export interface ContextMenuPortalProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Portal
> {}

export interface ContextMenuSubProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.Sub
> {}

export interface ContextMenuSubTriggerProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.SubTrigger
> {
  readonly inset?: boolean;
}

export interface ContextMenuSubContentProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.SubContent
> {
  /**
   * 菜单面板的**最小**宽度挡位。菜单项文字长度不可预知，故是下限不是定宽。
   */
  readonly width?: OverlayWidth;
}

export interface ContextMenuRadioGroupProps extends React.ComponentPropsWithoutRef<
  typeof ContextMenuPrimitive.RadioGroup
> {}

const ContextMenu = ContextMenuPrimitive.Root;

const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

const ContextMenuGroup = ContextMenuPrimitive.Group;

const ContextMenuPortal = ContextMenuPrimitive.Portal;

const ContextMenuSub = ContextMenuPrimitive.Sub;

const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup;

const ContextMenuSubTrigger = React.forwardRef<
  HTMLDivElement,
  ContextMenuSubTriggerProps
>(function ContextMenuSubTrigger(
  { className, inset, children, ...props },
  ref,
) {
  return (
    <ContextMenuPrimitive.SubTrigger
      ref={ref}
      className={cn(
        "flex cursor-default select-none items-center rounded-sm px-sm py-xs text-body-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
        inset && "pl-2xl",
        className,
      )}
      {...props}
    >
      {children}
      <Icon name="chevron-right" size={16} className="ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  );
});

const ContextMenuSubContent = React.forwardRef<
  HTMLDivElement,
  ContextMenuSubContentProps
>(function ContextMenuSubContent({ className, width = "xs", ...props }, ref) {
  return (
    <ContextMenuPrimitive.SubContent
      ref={ref}
      className={cn(
        cn(
          overlayMinWidthClass[width],
          "z-dropdown overflow-hidden p-2xs",
          panel.base,
          panel.popover,
          overlayMotion,
        ),
        className,
      )}
      {...props}
    />
  );
});

const ContextMenuContent = React.forwardRef<
  HTMLDivElement,
  ContextMenuContentProps
>(function ContextMenuContent({ className, width = "xs", ...props }, ref) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        ref={ref}
        className={cn(
          cn(
            overlayMinWidthClass[width],
            "z-dropdown overflow-hidden p-2xs",
            panel.base,
            panel.popover,
            overlayMotion,
          ),
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
});

const ContextMenuItem = React.forwardRef<HTMLDivElement, ContextMenuItemProps>(
  function ContextMenuItem({ className, inset, ...props }, ref) {
    return (
      <ContextMenuPrimitive.Item
        ref={ref}
        className={cn(
          "relative flex cursor-default select-none items-center rounded-sm px-sm py-xs text-body-sm outline-none transition-colors focus:bg-accent focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-disabled",
          inset && "pl-2xl",
          className,
        )}
        {...props}
      />
    );
  },
);

const ContextMenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  ContextMenuCheckboxItemProps
>(function ContextMenuCheckboxItem(
  { className, children, checked, ...props },
  ref,
) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-xs pl-2xl pr-sm text-body-sm outline-none transition-colors focus:bg-accent focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-disabled",
        className,
      )}
      {...(checked !== undefined ? { checked } : {})}
      {...props}
    >
      <span className="absolute left-sm flex size-icon-sm items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Icon name="check" size={16} />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
});

const ContextMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  ContextMenuRadioItemProps
>(function ContextMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <ContextMenuPrimitive.RadioItem
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-xs pl-2xl pr-sm text-body-sm outline-none transition-colors focus:bg-accent focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-disabled",
        className,
      )}
      {...props}
    >
      <span className="absolute left-sm flex size-icon-sm items-center justify-center">
        <ContextMenuPrimitive.ItemIndicator>
          <Icon name="check" size={16} />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
});

const ContextMenuLabel = React.forwardRef<
  HTMLDivElement,
  ContextMenuLabelProps
>(function ContextMenuLabel({ className, inset, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Label
      ref={ref}
      className={cn(
        "px-sm py-xs text-label-md font-semibold",
        inset && "pl-2xl",
        className,
      )}
      {...props}
    />
  );
});

const ContextMenuSeparator = React.forwardRef<
  HTMLDivElement,
  ContextMenuSeparatorProps
>(function ContextMenuSeparator({ className, ...props }, ref) {
  return (
    <ContextMenuPrimitive.Separator
      ref={ref}
      className={cn("-mx-2xs my-2xs h-px bg-border", className)}
      {...props}
    />
  );
});

const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-body-sm tracking-widest opacity-subtle",
        className,
      )}
      {...props}
    />
  );
};
ContextMenuShortcut.displayName = "ContextMenuShortcut";

ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName;
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName;
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName;
ContextMenuItem.displayName = ContextMenuPrimitive.Item.displayName;
ContextMenuCheckboxItem.displayName =
  ContextMenuPrimitive.CheckboxItem.displayName;
ContextMenuRadioItem.displayName = ContextMenuPrimitive.RadioItem.displayName;
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName;
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName;

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
  ContextMenuShortcut,
};
