/**
 * Textarea.tsx - 多行输入（shadcn 惯例）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Form
 *
 * 视觉规格取 shadcn vega。与 Input 共用同一套边框、底色与配方，差别只在最小高度与
 * `field-sizing-content`（随内容增高）。两者必须看起来是一家的——同一表单里
 * 单行和多行长得不一样是最容易被察觉的不一致。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { interactive, invalid } from "../../../styles/recipes";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-slot="textarea"
        className={cn(
          "flex field-sizing-content min-h-row-4xl w-full rounded-md border border-input px-sm py-xs",
          "bg-transparent shadow-raised dark:bg-input/30",
          "text-body-lg md:text-body-md text-foreground placeholder:text-muted-foreground",
          interactive,
          invalid,
          "disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";
