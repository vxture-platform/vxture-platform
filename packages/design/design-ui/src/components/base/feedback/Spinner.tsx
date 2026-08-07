/**
 * Spinner.tsx - 行内加载指示（shadcn 惯例 + 本仓图标源）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Feedback
 *
 * 与 Skeleton 的分工：**Skeleton 占位（内容还没来，先撑住版式），Spinner 等待
 * （动作发出去了，结果还没回来）**。按钮提交中、行内刷新用 Spinner；列表首屏用
 * Skeleton。
 *
 * 上游 Spinner 是 Loader2 图标加 animate-spin；本仓图标单一来源是 Phosphor
 * （iconRegistry 收口），故取字典里现成的 `spinner`（CircleNotch），不引第二个
 * 图标库。尺寸档与图标刻度逐档同值。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import type { IconSize } from "../../../icons";

/** 尺寸档的**运行时数组**，类型由它推导。预览面遍历全部档位时引这里，不再手抄。 */
export const SPINNER_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;

export type SpinnerSize = (typeof SPINNER_SIZES)[number];

/** Spinner 档位是图标刻度的子集——此处编译期对账，图标刻度改档这里跟着报错。 */
type _SpinnerSizeIsIconSize = SpinnerSize extends IconSize ? true : never;
export type _SpinnerSizeCheck = _SpinnerSizeIsIconSize;

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly size?: SpinnerSize;
  /**
   * 播报文案。给了就以 `role="status"` 播报并渲染 sr-only 文本；不给则整体
   * `aria-hidden`——旁边必然还有别的文字在说明发生了什么（按钮文案、行内提示），
   * 让读屏读两遍是噪音。文案是产品的话，DS 不带默认值。
   */
  readonly label?: string;
}

export function Spinner({
  size = "md",
  label,
  className,
  ...props
}: SpinnerProps) {
  return (
    <span
      data-slot="spinner"
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("inline-flex items-center justify-center", className)}
      {...props}
    >
      <Icon name="spinner" size={size} className="animate-spin" />
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
