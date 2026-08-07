/**
 * Kbd.tsx - 键位标示（shadcn 惯例）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Display
 *
 * 结构承上游 Kbd / KbdGroup。取值差异：上游的 text-[0.7rem]、px-1.5 等裸数值
 * 不跟随，改绑 T2（text-code-sm / px-2xs）——键位本质是代码字面量，走 code 族
 * 等宽字体，Ctrl 和 K 才一样宽。
 *
 * 只做标示不做交互：真正的快捷键由 Command 面板与产品侧注册，Kbd 只负责
 * "告诉用户按什么"。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";

export type KbdProps = React.HTMLAttributes<HTMLElement>;

export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-control-3xs w-fit min-w-control-3xs select-none",
        "items-center justify-center gap-2xs rounded-sm px-2xs",
        "bg-muted text-code-sm text-muted-foreground",
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-icon-xs",
        className,
      )}
      {...props}
    />
  );
}

/** 组合键（Ctrl + K）：一串 Kbd 加连接符。间距收在这里，调用方不散排。 */
export function KbdGroup({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-2xs", className)}
      {...props}
    />
  );
}
