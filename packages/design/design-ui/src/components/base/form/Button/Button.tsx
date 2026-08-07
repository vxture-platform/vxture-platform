/**
 * Button.tsx - 按钮（shadcn 惯例 + cva）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Common
 *
 * 结构承 shadcn 官方 Button，取值全部绑 DS 的 T2 语义层。本组件是其余 Radix
 * 组件 cva 化的样板。
 *
 * 两条纪律：
 * 1. **不建 T3。** 治理门槛规定 Button 直接绑 T2，故不引用任何 --button-* 组件层
 *    token（既有 --vx-button-height / --vx-button-radius 属伪 T3，不消费）。
 * 2. **尺度走 T2 语义名。** 颜色用 bg-primary / text-primary-foreground，尺寸用
 *    h-control-lg / px-md / gap-xs / size-icon-sm——都是 T2 注册出的真工具类，
 *    且跟随密度三档；裸数值（h-9 / px-4）不跟随，故不用。任意值语法一律禁止。
 *
 * 原先由 Tailwind 工具类与 .vx-btn 两套机制同时驱动的实现已被本文件取代：
 * 遗留样式层退役后 .vx-btn 无定义，两套并行的前提消失。
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../../../utils/cn";
import {
  expandable,
  iconInset,
  inlineIcon,
  interactive,
  invalid,
  pressable,
  radiusClamp,
} from "../../../../styles/recipes";
import type { ButtonVariant, ButtonSize } from "./Button.types";

const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none",
    // 尺度一律走 T2 语义名产出的工具类，不用裸数值：p-lg 之类不跟随密度三档，
    // 而 gap-xs / h-control-md 会。任意值语法（gap-(--gap-xs)）仍然禁止。
    "gap-xs rounded-md border border-transparent bg-clip-padding",
    "text-label-md",
    interactive,
    pressable,
    invalid,
    inlineIcon,
    iconInset,
  ),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active",
        // 危险动作用淡底不用实心：一屏里若有多个删除入口，实心红会把视觉重量
        // 全吸过去。真正的拦截交给二次确认，不靠按钮颜色吓人。
        // 用实色 muted 阶而非上游的 `/10` alpha——alpha 叠在未知底色上结果不定，
        // 且不自适应暗色（上游为此要补写一行 dark:）。
        destructive: cn(
          "bg-destructive-muted text-destructive-muted-foreground",
          "hover:bg-destructive-muted-hover active:bg-destructive-muted-active",
          "focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        ),
        // 实心红只留给"落锤"的那一下：确认对话框里的提交。
        // 判据是数量——入口按钮一屏可能有十个，淡底避免它们抢走全部注意力；
        // 而确认按钮一屏只有一个，且按下去不可撤销，弱化它是在帮倒忙。
        "destructive-strong": cn(
          "bg-destructive text-destructive-foreground",
          "hover:bg-destructive-hover active:bg-destructive-active",
          "focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        ),
        outline: cn(
          // 边取 input 而非 border：outline 按钮总是与输入框、下拉排在同一行，
          // 结构线（border）比控件边（input）淡一档，混排时深浅不齐。
          "border-input bg-background text-foreground",
          "hover:bg-accent hover:text-foreground",
          expandable,
        ),
        secondary: cn(
          "bg-primary-muted text-primary-muted-foreground hover:bg-primary-muted-hover",
          expandable,
        ),
        ghost: cn("text-foreground hover:bg-accent", expandable),
        link: "text-link underline-offset-4 hover:underline hover:text-link-hover",
      },
      /* 档名 = token 名，一一对应，没有第二套记法：
       *   xs 24 · sm 28 · md 32 · lg 36 · xl 40   （= --space-control-*）
       * `md` 是默认档，与外壳（header / 面板 / 侧栏）同高。
       *
       * 这套对应是 2026-08-04 补的。此前档名与 token 名整体错位一格
       * （`sm` 指的是 control-md、`default` 也是 control-md、`lg` 是
       * control-xl），于是同一个 32px 有两个名字、而 control-sm(28) 与
       * control-lg(36) 根本叫不出来。错位本身不产生视觉问题，产生的是
       * "读代码算不出高度"——每次都要回来查表。
       *
       * 横向内距跟着档位走（px-xs / px-sm / px-md / px-lg），不再由调用方
       * 选档时顺带决定：改名前 `size="sm"` 是 px-sm、不传 size 是 px-md，
       * 两者高度同为 32 却胖瘦不同，排在一行里能看出参差。这跟当初 32/36
       * 并存是同一类毛病，一并收掉。 */
      size: {
        // 小档另行封顶圆角：`rounded-md` 在基数调大后会让 24–32px 的按钮发胖。
        xs: cn("h-control-xs px-xs text-label-sm", radiusClamp),
        sm: cn("h-control-sm px-sm text-label-sm", radiusClamp),
        md: cn("h-control-md px-md", radiusClamp),
        lg: "h-control-lg px-lg",
        xl: "h-control-xl px-lg",
        "icon-xs": cn("size-control-xs p-0", radiusClamp),
        "icon-sm": cn("size-control-sm p-0", radiusClamp),
        "icon-md": cn("size-control-md p-0", radiusClamp),
        "icon-lg": "size-control-lg p-0",
        "icon-xl": "size-control-xl p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

/**
 * cva 的变体键必须与公开的 ButtonVariant / ButtonSize 联合类型一致。
 * 两处各写一份必然漂移，且漂移是静默的——多出的键照样产出样式，
 * 消费方却在类型上拿不到。此处编译期对账。
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type _VariantKeysMatch = Expect<
  Equal<
    NonNullable<VariantProps<typeof buttonVariants>["variant"]>,
    ButtonVariant
  >
>;
export type _SizeKeysMatch = Expect<
  Equal<NonNullable<VariantProps<typeof buttonVariants>["size"]>, ButtonSize>
>;

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  readonly asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant ?? "default"}
      data-size={size ?? "default"}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});

export { Button, buttonVariants };
