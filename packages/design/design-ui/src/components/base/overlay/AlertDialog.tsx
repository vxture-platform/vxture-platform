/**
 * AlertDialog.tsx - 阻断式确认对话框。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Floating
 *
 * 结构照 shadcn 官方 AlertDialog，取值换成 T2 语义类。与 Dialog 的分工：
 * Dialog 是可以随手关掉的容器，AlertDialog 强制二选一——所以**没有 X 关闭钮**，
 * Esc 与点遮罩也不关（Radix AlertDialog 原语自身的行为），用户必须在
 * Action / Cancel 之间表态。
 *
 * Action / Cancel 不重写按钮样式，直接引 Button 的 `buttonVariants`——上游同款
 * 做法。落锤动作若不可撤销，调用方给 Action 传
 * `buttonVariants({ variant: "destructive-strong" })`。
 */

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "../../../utils/cn";
import { overlayMotion, panel } from "../../../styles/recipes";
import { buttonVariants } from "../form/Button";

export interface AlertDialogProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Root
> {}

export interface AlertDialogTriggerProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Trigger
> {}

export interface AlertDialogPortalProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Portal
> {}

export interface AlertDialogOverlayProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Overlay
> {}

export interface AlertDialogContentProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Content
> {}

export interface AlertDialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export interface AlertDialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export interface AlertDialogTitleProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Title
> {}

export interface AlertDialogDescriptionProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Description
> {}

export interface AlertDialogActionProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Action
> {}

export interface AlertDialogCancelProps extends React.ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Cancel
> {}

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  HTMLDivElement,
  AlertDialogOverlayProps
>(function AlertDialogOverlay({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-modal bg-scrim",
        // 同 Dialog：虚化传达"下层已失效"，不支持的浏览器只是少一层虚化。
        "supports-backdrop-filter:backdrop-blur-xs",
        "duration-fast data-[state=open]:animate-in data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
});

const AlertDialogContent = React.forwardRef<
  HTMLDivElement,
  AlertDialogContentProps
>(function AlertDialogContent({ className, ...props }, ref) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          // 同 Dialog：`max-w-lg` 会命中 --spacing-lg 而非面板宽，必须走 panel 族。
          "fixed left-[50%] top-[50%] z-modal grid w-full max-w-panel-md",
          "translate-x-[-50%] translate-y-[-50%] gap-lg p-xl outline-none",
          panel.base,
          panel.dialog,
          overlayMotion,
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
});

const AlertDialogHeader = ({ className, ...props }: AlertDialogHeaderProps) => (
  <div
    className={cn(
      "flex flex-col space-y-xs text-center sm:text-left",
      className,
    )}
    {...props}
  />
);

const AlertDialogFooter = ({ className, ...props }: AlertDialogFooterProps) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-sm",
      className,
    )}
    {...props}
  />
);

const AlertDialogTitle = React.forwardRef<
  HTMLHeadingElement,
  AlertDialogTitleProps
>(function AlertDialogTitle({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Title
      ref={ref}
      className={cn(
        "text-lg font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  );
});

const AlertDialogDescription = React.forwardRef<
  HTMLParagraphElement,
  AlertDialogDescriptionProps
>(function AlertDialogDescription({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Description
      ref={ref}
      className={cn("text-body-sm text-muted-foreground", className)}
      {...props}
    />
  );
});

const AlertDialogAction = React.forwardRef<
  HTMLButtonElement,
  AlertDialogActionProps
>(function AlertDialogAction({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Action
      ref={ref}
      className={cn(buttonVariants(), className)}
      {...props}
    />
  );
});

const AlertDialogCancel = React.forwardRef<
  HTMLButtonElement,
  AlertDialogCancelProps
>(function AlertDialogCancel({ className, ...props }, ref) {
  return (
    <AlertDialogPrimitive.Cancel
      ref={ref}
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  );
});

AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;
AlertDialogHeader.displayName = "AlertDialogHeader";
AlertDialogFooter.displayName = "AlertDialogFooter";
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName;
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
