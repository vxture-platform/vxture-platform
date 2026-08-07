/**
 * Skeleton.tsx - 加载占位（shadcn 惯例 + 本仓的形态扩展）。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Display
 *
 * 上游 Skeleton 只有一行 `animate-pulse rounded-md bg-accent`，形状全靠调用方写
 * className。本仓保留 `variant` / `lines` 两个扩展，理由是多行文本占位是列表页
 * 里最常见的形态，交给调用方每处手写 `space-y-* + w-*` 会各写各的。
 *
 * 尺寸仍走 style 内联：占位块的宽高是运行时数据（"这段文字大概多宽"），
 * 不属于设计刻度，不该占用 T2 的命名。
 *
 * 原实现整体依赖 .vx-skeleton* 类族，随遗留样式层退役后完全无样式。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly variant?: "line" | "rect" | "circle";
  readonly width?: number | string;
  readonly height?: number | string;
  /** 仅 variant="line" 有效：渲染多行，末行收窄以模拟段落尾。 */
  readonly lines?: number;
}

const VARIANT_CLASS: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  line: "h-row-sm w-full rounded-sm",
  rect: "w-full rounded-md",
  circle: "size-media-xs rounded-full",
};

function toCssLength(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

function sizeStyle(
  width: SkeletonProps["width"],
  height: SkeletonProps["height"],
): React.CSSProperties | undefined {
  const w = toCssLength(width);
  const h = toCssLength(height);
  if (!w && !h) return undefined;
  return { ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) };
}

export function Skeleton({
  variant = "line",
  width,
  height,
  lines,
  className,
  style,
  ...props
}: SkeletonProps) {
  const base = cn("animate-pulse bg-muted", VARIANT_CLASS[variant], className);
  const inline = { ...sizeStyle(width, height), ...style };

  if (variant === "line" && lines && lines > 1) {
    return (
      <div className="flex flex-col gap-xs" {...props}>
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={cn(base, index === lines - 1 && "w-3/5")}
            style={inline}
            aria-hidden
          />
        ))}
      </div>
    );
  }

  return <div className={base} style={inline} aria-hidden {...props} />;
}
