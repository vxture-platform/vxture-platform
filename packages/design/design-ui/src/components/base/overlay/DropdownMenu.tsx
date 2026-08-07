/**
 * dropdown-menu.tsx - DropdownMenu 组件
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Navigation
 */

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../../../utils/cn";
import { overlayMotion, panel } from "../../../styles/recipes";
import { Icon } from "../../../icons";
import { overlayMinWidthClass, type OverlayWidth } from "../../overlayWidth";

export interface DropdownMenuProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Root
> {}

export interface DropdownMenuTriggerProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Trigger
> {}

export interface DropdownMenuContentProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
> {
  /**
   * 菜单面板的**最小**宽度挡位。菜单项文字长度不可预知，故是下限不是定宽。
   */
  readonly width?: OverlayWidth;
}

export interface DropdownMenuItemProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Item
> {
  readonly inset?: boolean;
}

export interface DropdownMenuCheckboxItemProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.CheckboxItem
> {}

export interface DropdownMenuRadioItemProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.RadioItem
> {}

export interface DropdownMenuLabelProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Label
> {
  readonly inset?: boolean;
}

export interface DropdownMenuSeparatorProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Separator
> {}

export interface DropdownMenuGroupProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Group
> {}

export interface DropdownMenuPortalProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Portal
> {}

export interface DropdownMenuSubProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Sub
> {}

export interface DropdownMenuSubTriggerProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubTrigger
> {
  readonly inset?: boolean;
}

export interface DropdownMenuSubContentProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubContent
> {
  /**
   * 菜单面板的**最小**宽度挡位。菜单项文字长度不可预知，故是下限不是定宽。
   */
  readonly width?: OverlayWidth;
}

export interface DropdownMenuRadioGroupProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.RadioGroup
> {}

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
  HTMLDivElement,
  DropdownMenuSubTriggerProps
>(function DropdownMenuSubTrigger(
  { className, inset, children, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.SubTrigger
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
    </DropdownMenuPrimitive.SubTrigger>
  );
});

const DropdownMenuSubContent = React.forwardRef<
  HTMLDivElement,
  DropdownMenuSubContentProps
>(function DropdownMenuSubContent({ className, width = "xs", ...props }, ref) {
  return (
    <DropdownMenuPrimitive.SubContent
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

const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  DropdownMenuContentProps
>(function DropdownMenuContent(
  { className, sideOffset = 4, width = "xs", ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
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
    </DropdownMenuPrimitive.Portal>
  );
});

const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuItemProps & { inset?: boolean }
>(function DropdownMenuItem({ className, inset, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-sm py-xs text-body-sm outline-none transition-colors focus:bg-accent focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-disabled",
        inset && "pl-2xl",
        className,
      )}
      {...props}
    />
  );
});

const DropdownMenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuCheckboxItemProps
>(function DropdownMenuCheckboxItem(
  { className, children, checked, ...props },
  ref,
) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-xs pl-2xl pr-sm text-body-sm outline-none transition-colors focus:bg-accent focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-disabled",
        className,
      )}
      {...(checked !== undefined ? { checked } : {})}
      {...props}
    >
      <span className="absolute left-sm flex size-icon-sm items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Icon name="check" size={16} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});

const DropdownMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuRadioItemProps
>(function DropdownMenuRadioItem({ className, children, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.RadioItem
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-xs pl-2xl pr-sm text-body-sm outline-none transition-colors focus:bg-accent focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-disabled",
        className,
      )}
      {...props}
    >
      <span className="absolute left-sm flex size-icon-sm items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Icon name="check" size={16} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
});

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  DropdownMenuLabelProps & { inset?: boolean }
>(function DropdownMenuLabel({ className, inset, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Label
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

const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  DropdownMenuSeparatorProps
>(function DropdownMenuSeparator({ className, ...props }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      ref={ref}
      className={cn("-mx-2xs my-2xs h-px bg-border", className)}
      {...props}
    />
  );
});

const DropdownMenuShortcut = ({
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
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName;
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuShortcut,
};
