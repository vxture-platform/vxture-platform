/**
 * PanelList.tsx - 面板里的一列项，与 PanelItem 配对。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 叫"项"不叫"行"：仓里 Row 已经指表格行（Table / DataTable / DetailList）。面板里
 * 这些不是表格行——没有列、没有表头、不参与选择，同名会一路误导下去。
 *
 * 空态的**结构**在这里，**文案**由调用方给：说什么是业务判断（"数据源待建设"与
 * "暂无数据"是两件事），怎么摆是排版。
 */

import * as React from "react";
import { hairline } from "../../../styles/recipes";
import { cn } from "../../../utils/cn";

export interface PanelListProps {
  readonly children: React.ReactNode;
  /** 无内容时显示的说明。给了它就在 children 为空时接管。 */
  readonly empty?: React.ReactNode;
  readonly className?: string;
}

function PanelList({ children, empty, className }: PanelListProps) {
  const isEmpty = React.Children.count(children) === 0;

  if (isEmpty && empty) {
    return (
      <p className="py-md text-center text-body-sm text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <div
      className={cn(
        // 项间虚线：虚线分字段、实线开区块（V4）——项与项之间界的是字段级。
        "flex min-w-0 flex-col divide-y",
        hairline.divide,
        className,
      )}
    >
      {children}
    </div>
  );
}

export { PanelList };
