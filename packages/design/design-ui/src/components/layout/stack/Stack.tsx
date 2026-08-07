/**
 * Stack.tsx - 垂直堆叠布局组件
 * @package @vxture/design-ui
 *
 * 功能：提供类似 flex column 的垂直布局原语
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components
 */

import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../../utils/cn";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** 间距大小 */
  gap?: "xs" | "sm" | "md" | "lg";
  /** 对齐方式 */
  align?: "start" | "center" | "end" | "stretch";
}

/**
 * 间距走 T2 语义名，不用裸值。
 *
 * `gap-2` / `gap-4` 这类裸值**不跟随密度三档**——用户把密度切到紧凑，页面上别的
 * 东西都收了，只有布局原语排出来的间距纹丝不动。取值按像素对齐迁移，观感不变。
 */
const gapClasses = {
  xs: "gap-xs",
  sm: "gap-md",
  md: "gap-lg",
  lg: "gap-xl",
};

const alignClasses = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

export const Stack = forwardRef<HTMLDivElement, StackProps>(
  ({ gap = "md", align = "stretch", className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col",
          gapClasses[gap],
          alignClasses[align],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Stack.displayName = "Stack";
