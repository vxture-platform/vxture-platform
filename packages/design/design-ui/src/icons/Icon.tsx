/**
 * Icon.tsx - 图标组件
 * @package @vxture/design-ui
 *
 * 功能：提供统一的图标渲染组件，支持尺寸、粗细、颜色等自定义配置
 *       由 @vxture/design-ui 的包入口统一加 "use client" 边界
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Common
 */

import { iconRegistry } from "./iconRegistry";
import { cn } from "../utils/cn";
import type { IconProps, IconSize } from "./icon.types";

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 语义化尺寸到像素值的映射表
 */
/** 与 T2 的 `--spacing-icon-*` 逐档同值，两处改一处必须改另一处。 */
const sizeMap: Record<IconSize, number> = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  "2xl": 48,
};

/**
 * 具名档位对应的 `size-icon-*` 工具类。`inlineIcon` 配方（recipes.ts）用
 * `[&_svg:not([class*='size-'])]:size-icon-sm` 给"调用方没显式定尺寸"的
 * 图标兜底——判据是 className 里有没有 `size-` 子串。这里不补上这个类，
 * 只靠 width/height 属性传值的话，凡是套在带这条配方的控件（Button 及其
 * 衍生的 ShellIconButton 等）里的具名尺寸图标，全部会被兜底规则压回 16px，
 * width/height 属性拗不过后来居上的 CSS 规则。
 */
const sizeClassMap: Record<IconSize, string> = {
  xs: "size-icon-xs",
  sm: "size-icon-sm",
  md: "size-icon-md",
  lg: "size-icon-lg",
  xl: "size-icon-xl",
  "2xl": "size-icon-2xl",
};

/**
 * 占位符组件 - 当图标名称不匹配时使用
 */
const Placeholder = ({
  size = 16,
  className = "",
}: {
  readonly size?: number | string;
  readonly className?: string;
}) => (
  <span
    style={{ width: size, height: size, display: "inline-block" }}
    className={className}
  />
);

// ============================================================================
// 组件实现
// ============================================================================

/**
 * 图标组件
 *
 * 提供统一的图标渲染接口，通过名称从图标注册表中获取对应的图标组件
 * 支持尺寸、粗细、颜色等自定义配置
 *
 * @param name - 图标名称（必填）
 * @param size - 图标尺寸，默认 'md'
 * @param weight - 图标粗细，默认 'regular'
 * @param className - 自定义 CSS 类名
 * @param fallback - 降级图标名称
 * @param color - 图标颜色
 * @param rest - 其他透传属性
 * @example
 * ```tsx
 * <Icon name="home" size="lg" />
 * <Icon name="settings" weight="fill" className="text-vx-primary" />
 * ```
 */
export const Icon = ({
  name,
  size = "md",
  weight = "regular",
  className = "",
  fallback,
  color,
  ...rest
}: IconProps) => {
  // 获取对应的图标组件，支持降级
  const Component =
    iconRegistry[name] ??
    (fallback ? iconRegistry[fallback] : undefined) ??
    Placeholder;

  // 解析尺寸值
  const resolvedSize = typeof size === "number" ? size : (sizeMap[size] ?? 20);
  const sizeClassName =
    typeof size === "number" ? undefined : sizeClassMap[size];

  return (
    <Component
      weight={weight}
      size={resolvedSize}
      // cn 而非模板串拼接：`hidden` 与基类 `inline-flex` 同属 display 组，
      // 字符串拼接时两个都留下、由生成 CSS 的源顺序裁决——Checkbox 的 ✓ 与 −
      // 因此同时显形（调用方写了 hidden 却不生效）。合并必须走 tailwind-merge。
      className={cn("inline-flex shrink-0", sizeClassName, className)}
      aria-hidden
      {...(color !== undefined ? { color } : {})}
      {...rest}
    />
  );
};
