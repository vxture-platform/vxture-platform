/**
 * Section.tsx - view 内的板块容器。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 头部**复用 `SectionHeader`**，不自己再渲染一遍 h2——原实现（PageSection）就是
 * 各写各的，结果同为二级标题的两处排版并不一致。板块的标题层级只有一个来源。
 *
 * 两种 tone 表达的是"这块要不要从背景里托起来"，不是重要程度：
 *   default —— 不托起，靠留白与标题分层。绝大多数板块用这个。
 *   raised  —— 描边 + 卡片底色 + 内边距。用于需要与周围明确切开的块，
 *              例如危险操作区、或一组独立于上下文的设置。
 *
 * 名字用 raised 不用 muted：它对应视觉高度阶梯上的那一档，与 `shadow-raised`
 * 同源。muted 在色彩语义里已经表示"弱化"，两处同名不同义会互相污染。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { SectionHeader, type SectionHeaderLevel } from "./SectionHeader";
import type { IconName } from "../../../icons";

export type SectionTone = "default" | "raised";

export interface SectionProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  "title"
> {
  readonly title?: React.ReactNode;
  readonly level?: SectionHeaderLevel;
  readonly description?: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly icon?: IconName;
  readonly tone?: SectionTone;
  readonly children: React.ReactNode;
}

const Section = React.forwardRef<HTMLElement, SectionProps>(function Section(
  {
    className,
    title,
    level,
    description,
    action,
    icon,
    tone = "default",
    children,
    ...props
  },
  ref,
) {
  const hasHeader = Boolean(title || description || action);

  return (
    <section
      ref={ref}
      className={cn(
        "flex flex-col gap-md",
        tone === "raised" &&
          "rounded-xl bg-card p-lg shadow-raised ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    >
      {hasHeader && title ? (
        <SectionHeader
          title={title}
          {...(level ? { level } : {})}
          {...(description ? { description } : {})}
          {...(action ? { action } : {})}
          {...(icon ? { icon } : {})}
        />
      ) : null}
      <div className="flex flex-col gap-md">{children}</div>
    </section>
  );
});

Section.displayName = "Section";

export { Section };
