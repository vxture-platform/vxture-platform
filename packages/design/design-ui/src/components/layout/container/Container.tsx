/**
 * Container.tsx - 响应式内容容器组件
 * @package @vxture/design-ui
 *
 * 功能：提供居中的响应式内容容器，用于页面布局
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components
 */

import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../../utils/cn";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** 容器尺寸 */
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

/**
 * 宽度走 T2 的页面宽度族。
 *
 * `max-w-screen-*` 读的是断点值——断点是"从这个宽度起换布局"，不是"内容该多宽"，
 * 两者恰好同值纯属巧合。改指 `--container-page-*` 后，调整页面宽度不会连带
 * 改变响应式断点。取值逐档相同（640 / 768 / 1024 / 1280），观感不变。
 */
const sizeClasses = {
  sm: "max-w-page-sm",
  md: "max-w-page-md",
  lg: "max-w-page-lg",
  xl: "max-w-page-xl",
  full: "max-w-full",
};

export const Container = forwardRef<HTMLDivElement, ContainerProps>(
  ({ size = "lg", className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "w-full mx-auto px-4 sm:px-6 lg:px-8",
          sizeClasses[size],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Container.displayName = "Container";
