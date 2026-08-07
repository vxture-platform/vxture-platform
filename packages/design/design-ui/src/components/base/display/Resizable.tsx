/**
 * Resizable.tsx - 可拖分栏（shadcn 惯例，底层 react-resizable-panels v4）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Layout
 *
 * 与 SplitViewLayout 的分工：**SplitViewLayout 是定宽双栏（排布件，零视觉），
 * Resizable 是用户可拖的分栏（带把手，是控件）**——前者归 layout/，这件因把手
 * 可交互、有视觉，归 base/（与 ScrollArea 同判）。
 *
 * 底层是 v4 API（Group / Panel / Separator），与 shadcn 文档基于的 v2
 * （PanelGroup / PanelResizeHandle）不同代：布局与方向由 Group 自管，
 * 分隔条状态经 `data-separator="inactive|hover|active"` 暴露，方向经
 * `aria-orientation`。上游的类名不可平移，此处按 v4 的钩子重写。
 *
 * 取值差异：分隔线走透明模式的发丝线语义（bg-primary/10，暗色 /20），
 * 命中面积由库的 resizeTargetMinimumSize 负责，1px 可见线不用自己外扩热区。
 */

"use client";

import * as React from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "../../../utils/cn";
import { interactive } from "../../../styles/recipes";
import { Icon } from "../../../icons";

export function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("h-full w-full", className)}
      {...props}
    />
  );
}

export const ResizablePanel = Panel;

export interface ResizableHandleProps extends React.ComponentProps<
  typeof Separator
> {
  /** 显式把手抓点。不给时只有发丝线，靠近时经 hover 态显色。 */
  readonly withHandle?: boolean;
}

export function ResizableHandle({
  withHandle = false,
  className,
  children,
  ...props
}: ResizableHandleProps) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "group relative flex items-center justify-center",
        "bg-primary/10 dark:bg-primary/20",
        // 可见线厚度随方向：左右分栏的分隔条是竖线（aria-orientation=vertical）。
        "aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-px",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
        interactive,
        "data-[separator=hover]:bg-primary/25 data-[separator=active]:bg-ring",
        className,
      )}
      {...props}
    >
      {children ??
        (withHandle ? (
          <div
            className={cn(
              "z-10 flex shrink-0 items-center justify-center",
              "rounded-sm border border-input bg-card text-muted-foreground",
              // 左右分栏（竖分隔条）把 caret-up-down 转成左右指向。
              "group-aria-[orientation=vertical]:rotate-90",
            )}
          >
            <Icon name="caret-up-down" size="xs" />
          </div>
        ) : null)}
    </Separator>
  );
}
