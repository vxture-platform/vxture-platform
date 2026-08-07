/**
 * Input.tsx - 单行输入（shadcn 惯例）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 视觉规格取 shadcn vega，尺度与取色走 T2。相对上游的差异：
 * - 焦点环、禁用态、失效态由配方层提供，不在此手写——手写就会和别的控件漂移。
 * - `shadow-xs` → `shadow-raised`：同一个值，但保留语义名。
 *
 * **移动端 16px、md 起 14px** 是照抄上游的：iOS Safari 在字号小于 16px 的输入框
 * 获得焦点时会自动放大整个页面，且不可关闭。这不是排版偏好，是平台行为规避。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { interactive, invalid } from "../../../styles/recipes";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, type, ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          "flex h-control-md w-full min-w-0 rounded-md border border-input px-sm py-2xs",
          // 底色透明：输入框要贴着所在表面（卡片上是卡片色，页面上是页面色）。
          // 暗色下给一层浅填充，否则纯描边框在深底上几乎看不见。
          "bg-transparent shadow-raised dark:bg-input/30",
          "text-body-lg md:text-body-md text-foreground placeholder:text-muted-foreground",
          "file:inline-flex file:border-0 file:bg-transparent file:text-label-md file:text-foreground",
          interactive,
          invalid,
          "disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
