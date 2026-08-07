/**
 * Progress.tsx - 进度条。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Feedback
 *
 * 结构照 shadcn 官方 Progress，取值换成 T2 语义类。轨道语法对齐本仓已有的
 * 用量条（TokenCounter）：`bg-accent` 轨道 + `rounded-4xl` 封头——同一形状的
 * 东西在 DS 内不能有两套画法。填充用位移不用改宽度：宽度过渡会触发布局，
 * 位移只走合成层，这一条承自上游。
 */

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "../../../utils/cn";

export interface ProgressProps extends React.ComponentPropsWithoutRef<
  typeof ProgressPrimitive.Root
> {}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  function Progress({ className, value, ...props }, ref) {
    return (
      <ProgressPrimitive.Root
        ref={ref}
        className={cn(
          "relative h-xs w-full overflow-hidden rounded-4xl bg-accent",
          className,
        )}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className="h-full w-full flex-1 rounded-4xl bg-primary transition-all duration-base ease-standard"
          // 进度是运行时数据不是设计刻度，只能走内联 style。
          style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
        />
      </ProgressPrimitive.Root>
    );
  },
);

Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
