/**
 * Grid.tsx - 响应式网格布局组件
 * @package @vxture/design-ui
 *
 * 功能：提供简单的响应式网格布局辅助工具
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components
 */

import { forwardRef } from "react";
import type { HTMLAttributes } from "react";
import { cn } from "../../../utils/cn";

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  /** 列数 */
  columns?: number;
  /** 间距大小 */
  gap?: "xs" | "sm" | "md" | "lg";
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

const columnsClasses = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
  9: "grid-cols-9",
  10: "grid-cols-10",
  11: "grid-cols-11",
  12: "grid-cols-12",
};

export const Grid = forwardRef<HTMLDivElement, GridProps>(
  ({ columns = 3, gap = "md", className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "grid",
          columnsClasses[columns as keyof typeof columnsClasses] ||
            "grid-cols-3",
          gapClasses[gap],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);

Grid.displayName = "Grid";
