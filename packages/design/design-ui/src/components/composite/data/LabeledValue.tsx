/**
 * LabeledValue.tsx - 标签在上、读数在下的两行主体。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 与 `TableTitleCell` 是一对相反的朝向：那件是标题大、补充小（主角是名字），本件是
 * 标签小、读数大（主角是数字）。两件都用于 `PanelItem` 的主体槽。
 *
 * 与 `MetricCard` 的分工：那是一张卡（有边框、有语气顶缘、成排出现），本件只是
 * 两行文字——放进面板里的项，卡壳会变成卡中卡。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "../../base/display/StatusBadge";

export interface LabeledValueProps {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  /** 标签行内的挂件：口径说明的 `?` 一类。 */
  readonly labelSuffix?: React.ReactNode;
  /** 读数旁的一个标：环比、口径。 */
  readonly valueTag?: React.ReactNode;
  readonly valueTagTone?: StatusBadgeTone;
  /** 读数本身的语气。缺省跟随正文——读数是事实，不是状态。 */
  readonly tone?: StatusBadgeTone;
  readonly className?: string;
}

const VALUE_TONE: Record<StatusBadgeTone, string> = {
  neutral: "text-foreground",
  brand: "text-primary-text",
  info: "text-info-text",
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-destructive-text",
};

function LabeledValue({
  label,
  value,
  labelSuffix,
  valueTag,
  valueTagTone = "neutral",
  tone = "neutral",
  className,
}: LabeledValueProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2xs", className)}>
      <span className="flex min-w-0 items-center gap-xs text-label-sm text-muted-foreground">
        <span className="truncate">{label}</span>
        {labelSuffix ? <span className="shrink-0">{labelSuffix}</span> : null}
      </span>
      <span className="flex min-w-0 items-baseline gap-xs">
        <span
          className={cn("truncate text-title-lg font-bold", VALUE_TONE[tone])}
        >
          {value}
        </span>
        {valueTag ? (
          <StatusBadge tone={valueTagTone}>{valueTag}</StatusBadge>
        ) : null}
      </span>
    </div>
  );
}

export { LabeledValue };
