/**
 * Field.tsx - 表单行标准件（shadcn 惯例，取其核心子集）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 一行表单的四件套一次定齐：Label + 控件 + Description + Error 的间距、字级、
 * 颜色不再各表单各写。这是 DialogForm / FormPageTemplate 底下缺的那一层。
 *
 * 刻意不引 react-hook-form（上游 Form 组件的路线）：UI 层零表单框架绑定，
 * Field 只出 markup 与视觉，校验框架产品侧自选——错误信息经 `<FieldError>`
 * 或控件的 `aria-invalid` 进来，两条路都走标准无障碍属性。
 *
 * 上游的 FieldSet / FieldLegend / responsive orientation 未收：产品尚无实据，
 * 等出现再补（收录看实据不看设想）。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Label } from "./Label";

/** 方向档的**运行时数组**，类型由它推导。 */
export const FIELD_ORIENTATIONS = ["vertical", "horizontal"] as const;

export type FieldOrientation = (typeof FIELD_ORIENTATIONS)[number];

const ORIENTATION_CLASS: Record<FieldOrientation, string> = {
  /** 默认：标签在上。 */
  vertical: "flex-col gap-xs",
  /** 开关行、复选行：控件与标签同行，说明文字换行后仍对齐标签列。 */
  horizontal: "flex-row items-center gap-sm",
};

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly orientation?: FieldOrientation;
}

export function Field({
  orientation = "vertical",
  className,
  ...props
}: FieldProps) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(
        "flex w-full min-w-0",
        ORIENTATION_CLASS[orientation],
        // 失效态经 data-invalid 从 Field 下发：标签随控件一起变色，
        // 只红输入框会让用户找不到是哪一行错了。
        "data-[invalid=true]:[&_[data-slot=field-label]]:text-destructive-text",
        className,
      )}
      {...props}
    />
  );
}

/** 多行表单的编组：行距一次定齐（表单密度只在这里调，不散落在行间）。 */
export function FieldGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex w-full flex-col gap-lg", className)}
      {...props}
    />
  );
}

export function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn("w-fit", className)}
      {...props}
    />
  );
}

export function FieldDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-body-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * 错误信息。有内容才渲染；`role="alert"` 让读屏在错误出现的当下播报，
 * 而不是等用户巡航到这一行。
 */
export function FieldError({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  if (children === undefined || children === null || children === false) {
    return null;
  }
  return (
    <p
      role="alert"
      data-slot="field-error"
      className={cn("text-body-sm text-destructive-text", className)}
      {...props}
    >
      {children}
    </p>
  );
}
