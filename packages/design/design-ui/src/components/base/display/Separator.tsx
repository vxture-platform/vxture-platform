/**
 * Separator.tsx - 分隔线。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Display
 */

import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "../../../utils/cn";

export interface SeparatorProps extends React.ComponentPropsWithoutRef<
  typeof SeparatorPrimitive.Root
> {}

export const Separator = React.forwardRef<HTMLDivElement, SeparatorProps>(
  function Separator(
    { className, orientation = "horizontal", decorative = true, ...props },
    ref,
  ) {
    return (
      <SeparatorPrimitive.Root
        ref={ref}
        decorative={decorative}
        orientation={orientation}
        className={cn(
          "shrink-0 bg-border",
          // 1px 线用内置的 h-px / w-px：--border-width-* 只产出 border-* 工具类，
          // 落不到 height / width 上。
          orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
          className,
        )}
        {...props}
      />
    );
  },
);

Separator.displayName = SeparatorPrimitive.Root.displayName;
