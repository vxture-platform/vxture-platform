/**
 * SectionNav.tsx - 板块间导航，通常放在 `SplitViewLayout` 的左栏。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 数据驱动：调用方给 `items`，不给 markup。条目的两行结构（标签 + 描述）与右侧
 * meta 位由本件固定，各处不会长得不一样。
 *
 * 不复用 `Button`：条目是左对齐的两行块，而 Button 是单行居中的控件，套上去要靠
 * 一串 className 把它的布局全部覆盖掉。焦点环与禁用态仍与 Button 一致。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { interactive } from "../../../styles/recipes";

export interface SectionNavItem {
  readonly key: string;
  readonly label: React.ReactNode;
  readonly description?: React.ReactNode;
  /** 右侧附加物，通常是 StatusBadge 或计数。 */
  readonly meta?: React.ReactNode;
  readonly disabled?: boolean;
}

export interface SectionNavProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  "onSelect"
> {
  readonly items: readonly SectionNavItem[];
  readonly activeKey: string;
  readonly onSelect?: (key: string) => void;
}

const SectionNav = React.forwardRef<HTMLElement, SectionNavProps>(
  function SectionNav(
    {
      className,
      items,
      activeKey,
      onSelect,
      "aria-label": ariaLabel = "板块导航",
      ...props
    },
    ref,
  ) {
    return (
      <nav
        ref={ref}
        className={cn("flex flex-col gap-2xs", className)}
        aria-label={ariaLabel}
        {...props}
      >
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={active ? "true" : undefined}
              disabled={item.disabled}
              onClick={() => onSelect?.(item.key)}
              className={cn(
                "flex w-full items-start justify-between gap-sm rounded-md px-sm py-xs text-left",
                "border border-transparent",
                interactive,
                active
                  ? "bg-surface-selected text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className="flex min-w-0 flex-col gap-2xs">
                <span className="text-label-md">{item.label}</span>
                {item.description ? (
                  <span className="text-body-sm text-muted-foreground">
                    {item.description}
                  </span>
                ) : null}
              </span>
              {item.meta ? <span className="shrink-0">{item.meta}</span> : null}
            </button>
          );
        })}
      </nav>
    );
  },
);

SectionNav.displayName = "SectionNav";

export { SectionNav };
