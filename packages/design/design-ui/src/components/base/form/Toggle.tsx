/**
 * Toggle.tsx - 双态按钮。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Form
 *
 * 结构照 shadcn 官方 Toggle（cva），取值换成 T2 语义类。按下态用 `bg-accent`
 * 不用品牌色：它表达的是"当前生效"，与菜单展开、Tabs 未选中同族，满色品牌底
 * 会让一排格式开关看起来像一排主按钮。尺寸档映射与 Button 一致
 * （xs 24 / sm 28 / md 32 / lg 36 / xl 40）。
 *
 * 变体族导出为**运行时数组**（同 Button.types 的做法）：预览面遍历全部挡位时
 * 引它，手抄清单加了挡位不会跟着加，且不报错。
 */

import * as React from "react";
import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../../utils/cn";
import { inlineIcon, interactive, radiusClamp } from "../../../styles/recipes";

export const TOGGLE_VARIANTS = ["default", "outline"] as const;

export type ToggleVariant = (typeof TOGGLE_VARIANTS)[number];

/**
 * 档名与 Button **同名同映射**（xs 24 · sm 28 · md 32 · lg 36 · xl 40，加同名
 * 的 icon 正方档）。两件档名一致，换件时不用重学一套。
 *
 * 只装一个图标的开关必须用 `icon-*` 档：用 `sm` 这类带横向内距的档会得到
 * "宽 28 高 20"的扁片（2026-08-04 FilterBar 的列表/卡片切换实测）。
 */
export const TOGGLE_SIZES = [
  "xs",
  "sm",
  "md",
  "lg",
  "xl",
  "icon-xs",
  "icon-sm",
  "icon-md",
  "icon-lg",
  "icon-xl",
] as const;

export type ToggleSize = (typeof TOGGLE_SIZES)[number];

const toggleVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-xs whitespace-nowrap select-none",
    "rounded-md text-label-md text-foreground",
    "hover:bg-accent",
    interactive,
    inlineIcon,
    // ⚠ Toggle 发的是 `data-state="on|off"`，不是 checked——选择器必须写
    //   `data-[state=on]`，`data-on:` 编译得出但永远匹配不上。
    "data-[state=on]:bg-accent",
  ),
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent shadow-raised",
      },
      // 档位表与 Button 逐档相同，理由见那边的注释。
      size: {
        // 小档同 Button：另行封顶圆角，基数调大时不发胖。
        xs: cn("h-control-xs px-xs text-label-sm", radiusClamp),
        sm: cn("h-control-sm px-sm text-label-sm", radiusClamp),
        md: cn("h-control-md px-md", radiusClamp),
        lg: "h-control-lg px-lg",
        xl: "h-control-xl px-lg",
        "icon-xs": cn("size-control-xs p-none", radiusClamp),
        "icon-sm": cn("size-control-sm p-none", radiusClamp),
        "icon-md": cn("size-control-md p-none", radiusClamp),
        "icon-lg": "size-control-lg p-none",
        "icon-xl": "size-control-xl p-none",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

/** 同 Button：cva 键与公开联合类型编译期对账，漂移不再静默。 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type _ToggleVariantKeysMatch = Expect<
  Equal<
    NonNullable<VariantProps<typeof toggleVariants>["variant"]>,
    ToggleVariant
  >
>;
export type _ToggleSizeKeysMatch = Expect<
  Equal<NonNullable<VariantProps<typeof toggleVariants>["size"]>, ToggleSize>
>;

export interface ToggleProps
  extends
    React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root>,
    VariantProps<typeof toggleVariants> {}

const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(function Toggle(
  { className, variant, size, ...props },
  ref,
) {
  return (
    <TogglePrimitive.Root
      ref={ref}
      className={cn(toggleVariants({ variant, size }), className)}
      {...props}
    />
  );
});

Toggle.displayName = TogglePrimitive.Root.displayName;

export { Toggle, toggleVariants };
