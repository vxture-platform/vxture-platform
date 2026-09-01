/**
 * product-catalog-view.ts - 目录产品的展示映射（product_type → 文案键 / 图标）
 *
 * 目录只给 `product_type` 这一列，页面要把它变成一行类型标签与一个图标。产品矩阵、
 * 智能体广场与产品占位页共用这一份映射；类型标签本身在 products.json 的
 * `catalog.types` 里，没登记过的类型落到 `unknown`（「未分类」，与 opera 服务状态页
 * 同一措辞），图标同理退回通用的 package。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-08-31
 */

import type { IconName } from "@vxture/design-system";

export type ProductTypeKey =
  | "general_platform"
  | "external_platform"
  | "model_platform"
  | "capability_platform"
  | "data_platform"
  | "knowledge_platform"
  | "agent"
  | "general_agent"
  | "industry_agent"
  | "client"
  | "external"
  | "unknown";

/**
 * 每档写成**完整的字面量**，不做 `type-${x}` 之类的拼接：i18n 键与 IconName 都要在
 * 源码里可静态看见，拼出来的键既查不到也不报错。
 */
const TYPE_ICONS: Record<ProductTypeKey, IconName> = {
  general_platform: "cube",
  external_platform: "plugs-connected",
  model_platform: "cube",
  capability_platform: "sparkles",
  data_platform: "database",
  knowledge_platform: "server",
  agent: "agent",
  general_agent: "agent",
  industry_agent: "buildings",
  client: "desktop",
  external: "api",
  unknown: "package",
};

export function productTypeKey(productType: string): ProductTypeKey {
  if (Object.prototype.hasOwnProperty.call(TYPE_ICONS, productType)) {
    return productType as ProductTypeKey;
  }
  // 未登记的子型仍按 family 后缀归族，不落 unknown（否则显示未分类 + package 图标）。
  if (productType.endsWith("_agent")) return "agent";
  if (productType.endsWith("_platform")) return "general_platform";
  return "unknown";
}

export function productTypeIcon(productType: string): IconName {
  return TYPE_ICONS[productTypeKey(productType)];
}
