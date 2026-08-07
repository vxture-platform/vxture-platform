/**
 * Checkbox.tsx - 复选框。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Form
 *
 * 结构照 shadcn 官方 Checkbox，只把取值换成 DS 的 T2 语义类。不加 shadcn 没有
 * 的变体：尺寸由调用方经 className 覆写，与上游一致。
 *
 * 一处必要的偏离：补上半选态。上游只认 checked，`checked="indeterminate"` 时框不填色、
 * 却照样画勾，看上去像个坏掉的选中态。半选画短横、同样填色——`DataTable` 的表头
 * 复选框要的就是它。
 */

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { cn } from "../../../utils/cn";
import { Icon } from "../../../icons";
import { interactive, invalid } from "../../../styles/recipes";

export interface CheckboxProps extends React.ComponentPropsWithoutRef<
  typeof CheckboxPrimitive.Root
> {}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
          "peer group relative flex size-icon-sm shrink-0 items-center justify-center",
          "rounded-sm border border-input bg-transparent shadow-raised dark:bg-input/30",
          // 命中区外扩到 40×32，但不占布局（绝对定位的伪元素）。16px 的方框
          // 达不到任何平台的最小点击目标，而把方框本身放大会破坏与文字的比例。
          "after:absolute after:-inset-x-lg after:-inset-y-sm",
          interactive,
          invalid,
          "disabled:cursor-not-allowed",
          // ⚠ 用 `data-[state=checked]` 而非上游 radix 模板里的 `data-checked`：
          //   Radix 实际发的属性是 `data-state="checked"`，`data-checked` 编译得出
          //   类名但永远匹配不上——勾选后没有填充色，且不报错。
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
          "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator
          className={cn("flex items-center justify-center text-current")}
        >
          {/* 12（icon-xs）：方框 16px 含边框内容区只有 14px，16px 的字形
              会溢出圆角糊成一团——图标必须比容器小一档。 */}
          <Icon
            name="check"
            size={12}
            className="group-data-[state=indeterminate]:hidden"
          />
          <Icon
            name="minus"
            size={12}
            className="hidden group-data-[state=indeterminate]:block"
          />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
  },
);

Checkbox.displayName = CheckboxPrimitive.Root.displayName;
