/**
 * DialogForm.tsx - 对话框表单骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 固定四段结构：标题 / 说明 / 字段区 / 页脚。字段区由调用方给 markup——表单字段是
 * 业务形状；页脚不是，所以按钮由 props 描述，取消在左、提交在右、提交中禁用两侧，
 * 各处不会长得不一样。
 *
 * 相对原实现：删 `footer`（整段替换页脚等于让这件失去存在意义）、
 * `contentClassName`、`formClassName`；`submitVariant` / `cancelVariant` 收为
 * `danger` 一个开关——页脚只有"常规提交"与"危险提交"两种。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Button } from "../../base/form/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../base/overlay/Dialog";

export type DialogFormSize = "sm" | "md" | "lg";

/* 浮层面板宽走 panel 族（448 / 512 / 672）——裸 `max-w-md/lg` 会命中
   同名 spacing 档（见 Dialog 的塌宽事故注释）。 */
const BY_SIZE: Record<DialogFormSize, string> = {
  sm: "max-w-panel-sm",
  md: "max-w-panel-md",
  lg: "max-w-panel-lg",
};

export interface DialogFormProps extends Omit<
  React.ComponentPropsWithoutRef<typeof Dialog>,
  "children"
> {
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly size?: DialogFormSize;
  readonly children?: React.ReactNode;
  readonly submitLabel?: React.ReactNode;
  readonly cancelLabel?: React.ReactNode;
  /** 提交动作是破坏性的（删除、停用），提交按钮用 destructive 语义色。 */
  readonly danger?: boolean;
  readonly submitting?: boolean;
  readonly submitDisabled?: boolean;
  readonly onSubmit?: React.FormEventHandler<HTMLFormElement>;
}

function DialogForm({
  title,
  description,
  size = "md",
  children,
  submitLabel = "保存",
  cancelLabel = "取消",
  danger = false,
  submitting = false,
  submitDisabled = false,
  onSubmit,
  onOpenChange,
  ...props
}: DialogFormProps) {
  return (
    <Dialog
      {...(onOpenChange !== undefined ? { onOpenChange } : {})}
      {...props}
    >
      <DialogContent className={cn("w-full", BY_SIZE[size])}>
        <form className="flex flex-col gap-lg" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {children ? (
            /* 字段区自带滚动，**不由调用方各写一遍**。此前有三处手写
               `max-h-[60vh] overflow-y-auto pr-2xs`、其余一处没有——于是同样长的
               表单在不同页上一个能滚一个把对话框顶穿。滚动只发生在这一段：标题与
               页脚钉住，长表单滚到底时提交按钮仍在原位。
               `pr-2xs` 是给滚动条让位，不是装饰：不留这一格，聚焦环会被裁掉半圈。 */
            <div className="flex max-h-[60vh] flex-col gap-md overflow-y-auto pr-2xs">
              {children}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange?.(false)}
              disabled={submitting}
            >
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              variant={danger ? "destructive-strong" : "default"}
              disabled={submitDisabled || submitting}
            >
              {submitting ? "处理中…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export { DialogForm };
