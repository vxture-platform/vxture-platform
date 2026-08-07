/**
 * Badge.tsx - 徽标（shadcn 惯例 + cva）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Display
 *
 * 结构承 shadcn 官方 Badge，取值全部绑 T2 语义层。相对上游的定制：
 * - 增 `asChild`，使 Badge 能直接渲染成 <a>（上游 2024 后的版本已有此能力）。
 * - 保留 `forwardRef`：上游新版把它去掉是因为面向 React 19（ref 作为普通 prop
 *   传递），本包的 peer 范围仍含 React 18，去掉会让 StatusBadge 这类包装件拿不到 ref。
 * - 尺度走 T2（px-sm / py-2xs / text-label-sm），跟随密度与字号三档；
 *   上游的裸数值 px-2.5 / py-0.5 / text-xs 不跟随，故不用。
 * - **缺省是 `outline` 而非 `default`**（2026-08-05 owner 定，理由见下）。
 *
 * ## 缺省是描边
 *
 * 变体的名字与值域仍与上游一致（default/secondary/destructive/outline），只有
 * `defaultVariants` 换了——`variant="default"` 依旧是实心品牌底，它只是不再是
 * 缺省值。
 *
 * 起因：仓内 191 处 `<Badge>` 不带 variant，于是全都渲染成实心品牌蓝 + 白字。
 * 而它们说的几乎全是"这是个标签"——探针名、时间戳、分类、计数。实心品牌底是
 * **强调**手段，一屏几十个强调就等于没有强调，只剩满页跳眼的蓝。
 *
 * 上游那个缺省合理是因为上游的 Badge 通常一屏一两个。到我们这个量级，缺省必须
 * 是最安静的那一档，强调改成显式索取（`variant="default"`）。
 *
 * 与 `StatusBadge` 的分工也因此清楚了：Badge 是中性标签，StatusBadge 才带语气
 * 底色——后者本就建在 `outline` 之上再叠 `toneSurfaceClasses`，两件现在同源。
 *
 * 原实现用对象式 cn 手写变体，且挂了一个已随遗留样式层退役的 .vx-badge。
 */

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../../utils/cn";
import { iconInset, interactive, invalid } from "../../../styles/recipes";

const badgeVariants = cva(
  cn(
    // 定高：徽章常成簇出现（状态列里"正常 + 未认证"并排），高度不定就对不齐。
    "inline-flex h-control-2xs w-fit shrink-0 items-center justify-center gap-2xs",
    "overflow-hidden rounded-4xl border border-transparent px-sm py-2xs",
    "text-label-sm whitespace-nowrap",
    interactive,
    invalid,
    iconInset,
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
    "[&_svg:not([class*='size-'])]:size-icon-xs",
  ),
  {
    variants: {
      variant: {
        // hover 只在徽章本身是链接时才给——不可点的徽章有悬停反馈是在说谎。
        default:
          "bg-primary text-primary-foreground [a&]:hover:bg-primary-hover",
        secondary: cn(
          "bg-primary-muted text-primary-muted-foreground",
          "[a&]:hover:bg-primary-muted-hover",
        ),
        // 与 Button 同一判断：危险用淡底。徽章更需要如此——它常成片出现，
        // 满屏实心红会把整页的视觉重心压到异常状态上。
        destructive: cn(
          "bg-destructive-muted text-destructive-muted-foreground",
          "[a&]:hover:bg-destructive-muted-hover",
        ),
        outline: "border-border text-foreground [a&]:hover:bg-accent",
      },
    },
    defaultVariants: {
      // 不是 `default`——见文件头"缺省是描边"。
      variant: "outline",
    },
  },
);

/**
 * 变体的**运行时数组**，类型由它推导（同 Button.types 的写法）。
 * 预览面要遍历全部档位时引这里，不再手抄。
 */
export const BADGE_VARIANTS = [
  "default",
  "secondary",
  "destructive",
  "outline",
] as const;

export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

/** cva 的变体键必须与数组一致——两处各写一份必然漂移，此处编译期对账。 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type _BadgeVariantKeysMatch = Expect<
  Equal<
    NonNullable<VariantProps<typeof badgeVariants>["variant"]>,
    BadgeVariant
  >
>;

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  readonly asChild?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
});

Badge.displayName = "Badge";

export { Badge, badgeVariants };
