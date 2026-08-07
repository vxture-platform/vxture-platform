/**
 * Card.tsx - 卡片（shadcn 惯例）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Display
 *
 * 结构承 shadcn 官方 Card 的六件套。相对上游的定制：
 * - **透明模式**（workplan §1 V1）：卡片不铺实色，走 veil 叠层——页面只有一层
 *   实色底，卡片是叠在其上的半透明表面。`surface` 三档对应叠层透明度，
 *   层级越"实体化"越透（入口卡最实、大面积实体卡最透）。
 * - 无阴影：透明模式的层次由描边 + 透明度表达，阴影会把"贴在同一张纸上"的
 *   错觉打破。要浮起的是浮层（popover/dialog），不是卡片。
 * - 内边距走刻度、标题层次走 `text-title-sm`，跟随密度与字号三档；
 *   上游的 p-6 / text-2xl 是裸数值，不跟随。
 * - 竖向节奏落在 Card 本体（`py-xl` + `gap-xl`），Header / Content 只管横向
 *   `px-xl`——上游现行 Card 即此模型。旧的 `pt-none`（假设内容永远跟在页头后）
 *   让独立使用 CardContent 的卡顶部内边距归零（2026-08-03 opera 实测），退役。
 *
 * 原实现在每一件上都挂了 .vx-card__*，随遗留样式层一并退役。
 */

import * as React from "react";
import { cardVeil, hairline, veil } from "../../../styles/recipes";
import { cn } from "../../../utils/cn";

export type CardSurface = keyof typeof veil;

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 叠层档位：soft 大面积实体卡 / base 默认 / strong 入口卡。浓淡见 cardVeil。 */
  readonly surface?: CardSurface;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, style, surface = "base", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      // 底纹在基座上，基于 Card 的卡片全都继承——卡面不该各长各的。
      // 调用方的 style 后写，需要盖掉底纹时仍然盖得掉。
      style={{ ...cardVeil(surface), ...style }}
      className={cn(
        "flex flex-col gap-xl py-xl text-foreground",
        veil[surface],
        className,
      )}
      {...props}
    />
  );
});

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardHeader({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col gap-2xs px-xl", className)}
      {...props}
    />
  );
});

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, ...props }, ref) {
  return <h3 ref={ref} className={cn("text-title-sm", className)} {...props} />;
});

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return (
    <p
      ref={ref}
      className={cn("text-body-sm text-muted-foreground", className)}
      {...props}
    />
  );
});

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardContent({ className, ...props }, ref) {
  return <div ref={ref} className={cn("px-xl", className)} {...props} />;
});

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function CardFooter({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        // footer 与正文的界是"字段级"分隔，走虚线（workplan §1 V4）。
        // 竖向只补 pt：与正文的间距由 Card 的 gap 给，底部由 Card 的 py 收。
        "mx-xl mt-auto flex items-center gap-sm border-t pt-md",
        hairline.field,
        className,
      )}
      {...props}
    />
  );
});

Card.displayName = "Card";
CardHeader.displayName = "CardHeader";
CardTitle.displayName = "CardTitle";
CardDescription.displayName = "CardDescription";
CardContent.displayName = "CardContent";
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
