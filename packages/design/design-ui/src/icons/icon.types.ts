/**
 * icon.types.ts - 图标系统类型定义
 * @package @vxture/design-ui
 *
 * 功能：定义图标系统的全部类型，包括图标名称、尺寸、粗细、组件 Props 等
 *
 * @copyright Vxture Team
 * @layer Domain
 * @category Types
 */

import type { IconName as _IconName } from "./iconDictionary";

// ============================================================================
// Phosphor 变体类型
// ============================================================================

/**
 * Phosphor Icons 支持的 6 种粗细变体
 *
 * - thin      极细，装饰性场景
 * - light     细线，次要信息
 * - regular   默认，通用场景
 * - bold      加粗，强调/标题旁
 * - fill      实心填充，选中态 / 激活态
 * - duotone   双色，云服务/智能体状态展示
 */
export type IconWeight =
  | "thin"
  | "light"
  | "regular"
  | "bold"
  | "fill"
  | "duotone";

// ============================================================================
// 尺寸类型
// ============================================================================

/**
 * 语义化尺寸规格，与 T2 的 `--spacing-icon-*` 逐档同值。
 *
 * xs  → 12px  badge、tag 内嵌图标
 * sm  → 16px  按钮、菜单项、面包屑内的图标
 * md  → 20px  通用场景
 * lg  → 24px  卡片标题、侧边栏导航
 * xl  → 32px  强调位
 * 2xl → 48px  空状态主图
 *
 * 48 以上不是图标是图形，用 `--spacing-media-*`。
 *
 * 也接受 number 直接传像素值，用于特殊场景
 */
export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

// ============================================================================
// 组件 Props
// ============================================================================

/**
 * Icon 组件 Props 接口
 */
export interface IconProps {
  /**
   * 语义化图标名称，必填
   * 类型安全：只接受 iconDictionary 中定义的名称
   * 动态数据场景请配合 fallback 使用
   */
  readonly name: _IconName;

  /**
   * 图标尺寸
   * 接受语义化规格或直接传 px 数值
   * @default 'md'
   */
  readonly size?: IconSize | number | undefined;

  /**
   * Phosphor 粗细变体
   * @default 'regular'
   */
  readonly weight?: IconWeight | undefined;

  /**
   * 图标颜色，接受任意合法 CSS 颜色值
   * @default 'currentColor'  继承父元素文字颜色，推荐默认值
   */
  readonly color?: string | undefined;

  /**
   * 额外 className，用于 Tailwind 工具类覆盖
   * @example className="text-vx-primary"
   */
  readonly className?: string | undefined;

  /**
   * name 无匹配时的降级图标名
   * 主要用于 JSON / API 驱动的动态图标名场景
   * @default 'placeholder'
   */
  readonly fallback?: _IconName | undefined;
}

// ============================================================================
// 工具类型
// ============================================================================

/**
 * 将语义化 IconSize 转换为 px 数值的映射类型
 * 供 Icon.tsx 内部的 sizeMap 对象使用
 */
export type IconSizeMap = Record<IconSize, number>;

// ============================================================================
// 重新导出
// ============================================================================

/**
 * 所有合法的图标名称
 * 由 iconDictionary 推导，新增图标需同时更新 icon-dictionary.ts 和 icon-registry.ts
 *
 * @example
 * ```typescript
 * const name: IconName = 'agent'   // ✅
 * const name: IconName = 'rocket'  // ❌ TS 报错
 * ```
 */
export type IconName = _IconName;
