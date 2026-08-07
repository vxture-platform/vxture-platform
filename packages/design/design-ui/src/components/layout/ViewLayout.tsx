/**
 * ViewLayout.tsx - view 的纵向骨架。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 典型用法是 `ViewHeader` + 若干 `Section` 自上而下排开。「view」取自"有导航的
 * 页面"这类布局，但本件不依赖导航——没有导航的场景形状合适照用。
 *
 * 本件只负责它们之间的节奏：`gap-xl`，比 `Section` 内部的 `gap-md` 高一档，让
 * "板块之间"明显宽于"板块之内"。层级靠留白读出来，不靠分割线。
 *
 * 不设 `maxWidth`：内容区宽度是外壳的事（外壳知道侧栏占多少），view 只管纵向。
 * 原实现整体依赖 .vx-page-stack，退役后连间距都没有。
 */

import * as React from "react";
import { cn } from "../../utils/cn";

export type ViewLayoutProps = React.HTMLAttributes<HTMLDivElement>;

const ViewLayout = React.forwardRef<HTMLDivElement, ViewLayoutProps>(
  function ViewLayout({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-xl", className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);

ViewLayout.displayName = "ViewLayout";

export { ViewLayout };
