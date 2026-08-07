/**
 * PanelItem.tsx - 面板列表的一项：前导 · 主体 · 尾部。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 三槽都收 ReactNode，本件只管排布。主体**不做形态假设**——admin 总览里排名项是
 * "上大下小"（名字 + 补充），指标项是"上小下大"（标签 + 读数），朝向相反；主体交给
 * `TableTitleCell` / `LabeledValue` 这类表达件出，这里不猜（2026-08-06 盘点）。
 *
 * 不出 `onClick`：现有七个面板的项都不可点，跳转在面板头的"详情"。需要时再加。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";

export interface PanelItemProps {
  /** 前导记号：等级记号、徽章、图标。定宽轨，与上下项对齐。 */
  readonly lead?: React.ReactNode;
  readonly main: React.ReactNode;
  /** 尾部：读数、键值对。右对齐，按内容收缩。 */
  readonly trail?: React.ReactNode;
  readonly className?: string;
}

function PanelItem({ lead, main, trail, className }: PanelItemProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-md py-sm first:pt-none last:pb-none",
        className,
      )}
    >
      {lead ? (
        <span className="flex w-control-md shrink-0 justify-center">
          {lead}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{main}</div>
      {trail ? <div className="shrink-0 text-right">{trail}</div> : null}
    </div>
  );
}

export { PanelItem };
