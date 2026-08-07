/**
 * NativeSelect.tsx - 原生 `<select>`，外观与 `Input` 对齐。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 与 `Select`（Radix）并存而非二选一：Radix 那件把列表渲染进 portal，拿不到原生下拉
 * 的行为——移动端的系统选择器、表单原生提交、以及密集筛选行里不值得为一个下拉付出
 * portal 代价的场合，都要这一件。
 *
 * 本目录余下的件都是组合件，这一件是唯一的基础控件：`ui/` 只收上游有对应件的组件，
 * 而 shadcn 上游没有原生 select。
 *
 * 原实现挂 `.vx-input .vx-select-trigger` 两个已退役类，等于完全无样式；此处按 Input
 * 的尺度与焦点表现重写，并自绘箭头（原生箭头不跟随主题）。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { interactive, invalid } from "../../../styles/recipes";

export interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /**
   * 包裹层（相对定位容器）的类。宽度必须落在这里而不是 select 上——
   * 箭头图标锚定包裹层右缘，只收窄 select 会让箭头脱位（2026-08-03 opera 实测）。
   */
  readonly wrapperClassName?: string;
}

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  NativeSelectProps
>(function NativeSelect(
  { className, wrapperClassName, children, ...props },
  ref,
) {
  return (
    <span
      className={cn(
        "relative inline-flex w-full items-center",
        wrapperClassName,
      )}
    >
      <select
        ref={ref}
        data-slot="native-select"
        className={cn(
          "flex h-control-md w-full min-w-0 appearance-none rounded-md border border-input pl-sm pr-xl py-2xs",
          "bg-transparent shadow-raised dark:bg-input/30",
          "text-body-lg md:text-body-md text-foreground",
          interactive,
          invalid,
          "disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute right-sm text-muted-foreground"
      />
    </span>
  );
});

NativeSelect.displayName = "NativeSelect";
