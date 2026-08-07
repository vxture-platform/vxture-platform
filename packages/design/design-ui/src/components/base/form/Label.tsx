/**
 * Label.tsx - 表单标签。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Form
 */

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../../../utils/cn";

export interface LabelProps extends React.ComponentPropsWithoutRef<
  typeof LabelPrimitive.Root
> {}

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  function Label({ className, ...props }, ref) {
    return (
      <LabelPrimitive.Root
        ref={ref}
        className={cn(
          // flex + gap 是为了标签内联图标（必填星号、说明图标）能对齐基线，
          // 不加的话调用方会各自用 span 包一层，对齐方式就散了。
          "flex items-center gap-xs select-none",
          "text-label-md text-foreground",
          // Label 自己不可禁用，它跟随所描述的控件——故用 peer / group 而非配方。
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-disabled",
          "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-disabled",
          className,
        )}
        {...props}
      />
    );
  },
);

Label.displayName = LabelPrimitive.Root.displayName;
