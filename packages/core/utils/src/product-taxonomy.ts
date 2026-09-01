/**
 * product-taxonomy.ts - 产品类型(product_type)的单一权威源
 *
 * @package @vxture/core-utils
 * @description
 *   `product_type` 是「产品是什么」的**统一类型轴**,与另外两个正交维度分开维护:
 *     - **来源** = `product.products.origin` 列(`self` / `third_party` / `other`)。
 *       external(外部/合作)是**来源**,不是类型——外部产品同样有平台级与智能体。
 *     - **层级定位** = L1 / L2 / L3,是产品的定位,不是类型,单独维护。
 *
 *   类型本身收敛为对称的 2×2:{general, industry} × {platform, agent},外加一个
 *   `undefined`(未定义)兜底档,给尚未定型的产品先占位。识别按 family **后缀**
 *   (`_platform` / `_agent`)归族——将来新增子型(如某个新限定)只需在本文件补一行,
 *   消费方按后缀归族即可自动识别。
 *
 *   这是全线唯一权威源:opera 表单下拉、opera-bff 写入校验、各 BFF 的能力/层级映射、
 *   seed 都从这里取,**不再自由输入**。
 */

/** 受管的 product_type 全集——opera 表单下拉与写入校验只认这些。 */
export const PRODUCT_TYPES = [
  "general_platform",
  "industry_platform",
  "general_agent",
  "industry_agent",
  "undefined",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

/** family = 类型的大类;`undefined` 自成一档(既非平台也非智能体)。 */
export type ProductTypeFamily = "platform" | "agent" | "undefined";

export interface ProductTypeDef {
  readonly value: ProductType;
  readonly family: ProductTypeFamily;
  readonly labelZh: string;
  readonly labelEn: string;
}

/** 值 → 展示定义(下拉选项、标签)。顺序即下拉呈现顺序。 */
export const PRODUCT_TYPE_DEFS: readonly ProductTypeDef[] = [
  {
    value: "general_platform",
    family: "platform",
    labelZh: "通用平台",
    labelEn: "General Platform",
  },
  {
    value: "industry_platform",
    family: "platform",
    labelZh: "行业平台",
    labelEn: "Industry Platform",
  },
  {
    value: "general_agent",
    family: "agent",
    labelZh: "通用智能体",
    labelEn: "General Agent",
  },
  {
    value: "industry_agent",
    family: "agent",
    labelZh: "行业智能体",
    labelEn: "Industry Agent",
  },
  {
    value: "undefined",
    family: "undefined",
    labelZh: "未定义",
    labelEn: "Undefined",
  },
] as const;

/** 写入校验:是否受管枚举内的合法值。opera-bff 写入面用它挡住自由输入。 */
export function isValidProductType(value: string): value is ProductType {
  return (PRODUCT_TYPES as readonly string[]).includes(value);
}

/**
 * 归族:按 family 后缀判定大类。对历史遗留值(data_platform / model_platform /
 * capability_platform / knowledge_platform 等)也按 `_platform` 后缀归到 platform,
 * 保证过渡期消费方不落空;裸 `agent` 等无后缀历史值归 agent 由调用方按需另判。
 */
export function productTypeFamily(value: string): ProductTypeFamily {
  if (value.endsWith("_platform")) return "platform";
  if (value === "agent" || value.endsWith("_agent")) return "agent";
  return "undefined";
}

/** 取展示标签(缺省 zh)。未登记值退回原字符串,便于过渡期显影而非静默。 */
export function productTypeLabel(
  value: string,
  locale: "zh" | "en" = "zh",
): string {
  const def = PRODUCT_TYPE_DEFS.find((d) => d.value === value);
  if (!def) return value;
  return locale === "en" ? def.labelEn : def.labelZh;
}
