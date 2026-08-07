/**
 * InputGroup.tsx - 输入组：前后缀与输入框拼成一个框身（shadcn 惯例）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 框身样式从 Input 平移到容器上：描边、圆角、焦点环全在容器，内部输入框
 * 退成无框——**焦点环必须包住整组**，只亮输入框那一段会把前后缀衬得像另一个控件。
 * 焦点与失效态经 `has-[...]` 从内部控件上浮到容器，无 JS 状态。
 *
 * 与 ButtonGroup 的分工：InputGroup 是**一个**输入控件带附属物；
 * ButtonGroup 是**多个**动作并排。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";

/** 附属区位置档的**运行时数组**，类型由它推导。 */
export const INPUT_GROUP_ALIGNS = ["start", "end"] as const;

export type InputGroupAlign = (typeof INPUT_GROUP_ALIGNS)[number];

export function InputGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      data-slot="input-group"
      className={cn(
        "relative flex h-control-md w-full min-w-0 items-center",
        "rounded-md border border-input bg-transparent shadow-raised dark:bg-input/30",
        "transition-all duration-fast ease-standard",
        // interactive / invalid 配方挂在 :focus-visible / aria-invalid 本体上，
        // 组的框身在容器：用 has-[] 把内部控件的状态上浮成同一套视觉。
        "has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3",
        "has-[input:focus-visible]:ring-ring/50",
        "has-[input[aria-invalid=true]]:border-destructive",
        "has-[input[aria-invalid=true]]:ring-3 has-[input[aria-invalid=true]]:ring-destructive/20",
        "dark:has-[input[aria-invalid=true]]:border-destructive/50",
        "has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-disabled",
        className,
      )}
      {...props}
    />
  );
}

const ALIGN_CLASS: Record<InputGroupAlign, string> = {
  start: "pl-sm",
  end: "pr-sm",
};

export interface InputGroupAddonProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly align?: InputGroupAlign;
}

/** 前后缀区：图标、单位、内嵌小按钮。文字与图标统一取弱化色，不与输入内容抢重量。 */
export function InputGroupAddon({
  align = "start",
  className,
  ...props
}: InputGroupAddonProps) {
  return (
    <div
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        "flex shrink-0 select-none items-center gap-2xs",
        "text-body-md text-muted-foreground",
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-icon-sm",
        ALIGN_CLASS[align],
        className,
      )}
      {...props}
    />
  );
}

/** 组内输入框：框身已由容器承担，这里只剩排版与占位符。 */
export const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function InputGroupInput({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      data-slot="input-group-input"
      className={cn(
        "h-full w-full min-w-0 flex-1 bg-transparent px-sm outline-none",
        "text-body-lg md:text-body-md text-foreground placeholder:text-muted-foreground",
        "disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
});

InputGroupInput.displayName = "InputGroupInput";
