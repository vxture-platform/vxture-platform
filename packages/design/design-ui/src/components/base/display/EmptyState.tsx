/**
 * EmptyState.tsx - 空态。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 收录依据：产品扫描出现频次第三（console 4 / admin 44 处文件）。上游 shadcn
 * 没有对应件。
 *
 * 相对原实现只加了一个 `icon`：空态里的图标是这个图案的固定构成，不给它就等于
 * 让每个产品在外面套一层自己的 div 去放——那正是 admin 那 44 处各写各的来路。
 * 其余不加：没有 `variant`、没有尺寸档，空态的形状只有一种。
 *
 * 原实现整体依赖 .vx-empty-state，退役后连居中都没有。
 */

import * as React from "react";
import { Icon } from "../../../icons";
import type { IconName } from "../../../icons";
import { cn } from "../../../utils/cn";

export interface EmptyStateProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  readonly icon?: IconName;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly action?: React.ReactNode;
}

const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  function EmptyState(
    { className, icon, title, description, action, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col items-center justify-center gap-sm rounded-xl border border-dashed border-border",
          "px-lg py-3xl text-center",
          className,
        )}
        {...props}
      >
        {icon ? (
          <span
            className="flex size-media-sm items-center justify-center rounded-full bg-accent text-muted-foreground"
            aria-hidden="true"
          >
            <Icon name={icon} size="lg" />
          </span>
        ) : null}
        <div className="flex flex-col gap-2xs">
          <strong className="text-label-lg text-foreground">{title}</strong>
          {description ? (
            <p className="max-w-content-narrow-lg text-body-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? (
          <div className="flex items-center gap-sm">{action}</div>
        ) : null}
      </div>
    );
  },
);

EmptyState.displayName = "EmptyState";

export { EmptyState };
