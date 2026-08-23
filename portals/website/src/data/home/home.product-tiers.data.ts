/**
 * home.product-tiers.data.ts - 首页「产品体系」区块的四个层级
 *
 * 取代原先的「解决方案」轮播：那四项还是旧的技术平台分类，与 /solutions 改成
 * 四行业之后对不上，且四个 CTA 全部指向不存在的路由（2026-08-23 断链审计）。
 * 这里换成产品自身的四层递进，与产品中心的二级导航同一套分类。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Home
 * @author AI-Generated
 * @date 2026-08-23
 */

import type { IconName } from "@vxture/design-system";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 一个产品层级
 *
 * 强调色写成**完整工具类字符串**而非色名拼接：Tailwind 只为源码里字面出现的
 * 类名产出规则，拼接出来的不产出任何 CSS 且不报错。
 */
export interface ProductTier {
  /** i18n key，位于 `home.productTiers.items.*`。 */
  readonly id: string;
  readonly icon: IconName;
  readonly href: string;
  readonly cover: string;
  /** 图标底片。 */
  readonly chipClass: string;
  /** 强调文字。 */
  readonly inkClass: string;
}

// ============================================================================
// 数据
// ============================================================================

/** 顺序即层级顺序，也是环形切换的环序。 */
export const PRODUCT_TIERS: readonly ProductTier[] = [
  {
    id: "agents",
    icon: "app-grid",
    href: "/appcenter",
    cover: "/images/products/product-intro-01.webp",
    chipClass:
      "bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50 dark:text-vx-brand-200",
    inkClass: "text-vx-brand-600 dark:text-vx-brand-300",
  },
  {
    id: "platform",
    icon: "cube",
    href: "/products",
    cover: "/images/products/product-intro-02.webp",
    chipClass:
      "bg-vx-info-50 text-vx-info-600 dark:bg-vx-info-900/40 dark:text-vx-info-200",
    inkClass: "text-vx-info-600 dark:text-vx-info-300",
  },
  {
    id: "industry",
    icon: "buildings",
    href: "/industry-scenarios",
    cover: "/images/products/product-intro-03.webp",
    chipClass:
      "bg-vx-warning-50 text-vx-warning-600 dark:bg-vx-warning-900/40 dark:text-vx-warning-200",
    inkClass: "text-vx-warning-600 dark:text-vx-warning-300",
  },
  {
    id: "workbench",
    icon: "desktop",
    href: "/workbench",
    cover: "/images/products/product-intro-04.webp",
    chipClass:
      "bg-vx-success-50 text-vx-success-600 dark:bg-vx-success-900/40 dark:text-vx-success-200",
    inkClass: "text-vx-success-600 dark:text-vx-success-300",
  },
];

/**
 * 按「与激活项的环形距离」给出槽位与宽度。
 *
 * 下标 = (自身序号 − 激活序号 + 4) % 4，即环形距离：
 *   0 = 激活本身，1 = 后一个，2 = 对面那个（最远），3 = 前一个
 *
 * 槽位用 CSS `order` 指定而不是重排数组：重排会让 React 搬动 DOM 节点，宽度
 * 过渡随之跳变；`order` 只改视觉次序，节点不动，过渡才是连续的。
 *
 * 排布结果恒为「前一个 · 激活 · 后一个 · 最远」——激活项永远落在第 2 槽，
 * 两侧各有弱化项，不会出现一侧全是未激活的堆积。宽度合计 12/12。
 */
export const TIER_RING_LAYOUT = [
  { order: "order-2", basis: "basis-7/12", dim: "" },
  { order: "order-3", basis: "basis-2/12", dim: "opacity-70 grayscale" },
  { order: "order-4", basis: "basis-1/12", dim: "opacity-40 grayscale" },
  { order: "order-1", basis: "basis-2/12", dim: "opacity-70 grayscale" },
] as const;

/** 环形距离：0 自身，1 后一个，2 最远，3 前一个。 */
export function tierRingDistance(index: number, active: number): number {
  return (index - active + PRODUCT_TIERS.length) % PRODUCT_TIERS.length;
}
