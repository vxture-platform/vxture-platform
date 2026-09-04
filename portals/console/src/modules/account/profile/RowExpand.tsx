"use client";

/**
 * RowExpand — 字段行下方的行内展开区,与 DetailRow 的值列左对齐。
 * @package @vxture/console
 * @layer Application
 * @category Module
 *
 * DetailRow 宽屏是「12rem 定宽名列 + gap-lg + 值列」;展开区照同一骨架排:左边放
 * 一个等宽的空占位,右边才是内容框,于是框的左缘与上面那行的值对齐,而不是从名列
 * 开头就铺过来(owner 2026-09-04 走查:「信息框应该与信息内容对齐」)。窄屏名值上下
 * 堆叠,占位隐藏、框铺满。
 */

import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent } from "@vxture/design-system";
import { ROW_LABEL_WIDTH_CLASS } from "./CardRows";

export function RowExpand({
  open,
  onOpenChange,
  children,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleContent>
        <div className="flex flex-col pb-sm sm:flex-row sm:gap-lg">
          <span
            aria-hidden="true"
            className={`hidden sm:block ${ROW_LABEL_WIDTH_CLASS} sm:shrink-0`}
          />
          <div className="min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-md py-xs">
            {children}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
