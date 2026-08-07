"use client";

/**
 * EntryCard.tsx - 入口卡：通往一个功能区的门。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 提炼自 admin 的 overview 入口卡（workplan §1 / 调研 §3.1）。与 MetricCard 的
 * 分工：MetricCard 报数，EntryCard 引路——所以它整卡可点，而且是**唯一一个**
 * 图标带色块底的卡：门牌要比路标醒目，色块底是"这是个入口"的记号。
 *
 * 叠层取 strong（72%，三档里最实）——入口卡是页面的主角，实过普通内容卡。
 *
 * hover 走 `primary-muted`（brand-50）而非 accent：整卡染上一层极淡的品牌色，
 * 对齐 admin 的入口卡 hover 语义（V8）。
 */

import * as React from "react";
import { Icon, type IconName } from "../../../icons";
import { cardVeil, interactive, veil } from "../../../styles/recipes";
import { cn } from "../../../utils/cn";

export interface EntryCardProps extends Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "title"
> {
  readonly icon: IconName;
  readonly title: React.ReactNode;
  /** 标题行右端的角标：计数、状态词一类。 */
  readonly meta?: React.ReactNode;
  readonly description?: React.ReactNode;
}

const EntryCard = React.forwardRef<HTMLAnchorElement, EntryCardProps>(
  function EntryCard(
    { className, style, icon, title, meta, description, children, ...props },
    ref,
  ) {
    return (
      <a
        ref={ref}
        // 底纹与其余卡片同一份配方，见 recipes 的 cardVeil。
        style={{ ...cardVeil("strong"), ...style }}
        className={cn(
          "flex items-start gap-lg p-xl text-foreground",
          veil.strong,
          interactive,
          "cursor-pointer no-underline hover:bg-primary-muted/70",
          className,
        )}
        {...props}
      >
        <span
          className="flex size-media-xs shrink-0 items-center justify-center rounded-md bg-primary-muted text-primary-text"
          aria-hidden="true"
        >
          <Icon name={icon} size="lg" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-2xs">
          <span className="flex items-baseline justify-between gap-sm">
            <span className="truncate text-title-sm text-foreground">
              {title}
            </span>
            {meta ? (
              <span className="shrink-0 text-overline text-primary-text">
                {meta}
              </span>
            ) : null}
          </span>
          {description ? (
            <span className="text-body-sm text-muted-foreground">
              {description}
            </span>
          ) : null}
          {children}
        </span>
      </a>
    );
  },
);

EntryCard.displayName = "EntryCard";

export { EntryCard };
