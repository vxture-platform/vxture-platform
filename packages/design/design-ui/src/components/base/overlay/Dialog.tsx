/**
 * dialog.tsx - Dialog 组件
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Floating
 */

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { overlayMotion, panel } from "../../../styles/recipes";

export interface DialogProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Root
> {}

export interface DialogTriggerProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Trigger
> {}

export interface DialogPortalProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Portal
> {}

export interface DialogOverlayProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Overlay
> {}

export interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** 宽度档 = T2 panel 族（sm 28 / md 32 / lg 42 / xl 58rem）。缺省 md。 */
  readonly width?: "sm" | "md" | "lg" | "xl";
}

export interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export interface DialogTitleProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Title
> {}

export interface DialogDescriptionProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Description
> {}

export interface DialogCloseProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Close
> {}

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<HTMLDivElement, DialogOverlayProps>(
  function DialogOverlay({ className, ...props }, ref) {
    return (
      <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
          "fixed inset-0 z-modal bg-scrim",
          // 背景虚化让"下面那层已失效"一眼可辨，不必靠把遮罩加深来传达。
          // 挂在 supports 下：不支持的浏览器只是少一层虚化，遮罩本身照常。
          "supports-backdrop-filter:backdrop-blur-xs",
          "duration-fast data-[state=open]:animate-in data-[state=open]:fade-in-0",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      />
    );
  },
);

/**
 * 对话框宽度四档 = T2 panel 族（28 / 32 / 42 / 58rem）。
 * 同 overlayWidth 的纪律：类名必须写完整字面量（Tailwind 扫源码文本，拼接
 * 扫不到）；且每一档都要有工具类消费方，@theme 变量才会被 v4 吐出——
 * xl 档（2026-08-18 owner 批准新增）的 var() 消费方在 admin 的取值层里，
 * 没有这里这条字面量它会静默失效。
 */
export const DIALOG_WIDTHS = ["sm", "md", "lg", "xl"] as const;
export type DialogWidth = (typeof DIALOG_WIDTHS)[number];
const dialogWidthClass: Record<DialogWidth, string> = {
  sm: "max-w-panel-sm",
  md: "max-w-panel-md",
  lg: "max-w-panel-lg",
  xl: "max-w-panel-xl",
};

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  function DialogContent({ className, width = "md", children, ...props }, ref) {
    return (
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            // ⚠ 不能写上游的 `max-w-lg`：本仓 spacing 命名空间有同名 `--spacing-lg`，
            //   v4 宽度工具类优先吃 spacing 档——类名照常生成，对话框塌成 24px 宽。
            //   浮层面板宽走 panel 族（md = 512px，即上游 max-w-lg 的意图值）。
            "fixed left-[50%] top-[50%] z-modal grid w-full",
            dialogWidthClass[width],
            "translate-x-[-50%] translate-y-[-50%] gap-lg p-xl outline-none",
            panel.base,
            panel.dialog,
            overlayMotion,
            className,
          )}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-lg top-lg rounded-sm opacity-muted ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <Icon name="x" size={16} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);

const DialogHeader = ({ className, ...props }: DialogHeaderProps) => (
  <div
    className={cn(
      "flex flex-col space-y-xs text-center sm:text-left",
      className,
    )}
    {...props}
  />
);

const DialogFooter = ({ className, ...props }: DialogFooterProps) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-sm",
      className,
    )}
    {...props}
  />
);

const DialogTitle = React.forwardRef<HTMLHeadingElement, DialogTitleProps>(
  function DialogTitle({ className, ...props }, ref) {
    return (
      <DialogPrimitive.Title
        ref={ref}
        className={cn(
          "text-lg font-semibold leading-none tracking-tight",
          className,
        )}
        {...props}
      />
    );
  },
);

const DialogDescription = React.forwardRef<
  HTMLParagraphElement,
  DialogDescriptionProps
>(function DialogDescription({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-body-sm text-muted-foreground", className)}
      {...props}
    />
  );
});

DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;
DialogContent.displayName = DialogPrimitive.Content.displayName;
DialogHeader.displayName = "DialogHeader";
DialogFooter.displayName = "DialogFooter";
DialogTitle.displayName = DialogPrimitive.Title.displayName;
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
