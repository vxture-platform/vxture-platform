/**
 * industry-taxonomy.ts - 租户「所属行业」的单一权威源(自定义清单)
 *
 * @package @vxture/core-utils
 * @description
 *   console 租户信息页的「所属行业」从自由文本改为下拉(owner 2026-09-06:「行业清单,
 *   先自定义」——不套国标 GB/T 4754 的门类 / 大类,先用一份平台自己的粗粒度清单)。
 *   `tenancy.tenant_profiles.industry` 存这里的 **value**(码),不存展示文字;展示时
 *   按 locale 取标签。历史上手填的自由文本仍可能留在列里:`industryLabel` 对未登记值
 *   退回原字符串,页面把它当一个额外选项显影而不是吞掉。
 *
 *   product.solutions.industry(方案的行业领域)同样改读本清单(owner 2026-09-06「修改」):
 *   admin 方案表单下拉、admin-bff 写入校验都认这里的码;方案侧历史自由文本同样原样显影。
 *
 *   顺序即下拉呈现顺序。改清单只改本文件;消费方(console / admin 下拉、console-bff /
 *   admin-bff 写入校验、admin-bff 展示映射)都从这里取。
 */

/** 受管的行业码全集——console 下拉与写入校验只认这些。 */
export const INDUSTRIES = [
  "internet",
  "software",
  "ai",
  "finance",
  "manufacturing",
  "retail",
  "education",
  "healthcare",
  "government",
  "energy",
  "transport",
  "real_estate",
  "media",
  "professional_services",
  "agriculture",
  "other",
] as const;

export type Industry = (typeof INDUSTRIES)[number];

export interface IndustryDef {
  readonly value: Industry;
  readonly labelZh: string;
  readonly labelEn: string;
}

/** 值 → 展示定义(下拉选项、标签)。顺序即下拉呈现顺序。 */
export const INDUSTRY_DEFS: readonly IndustryDef[] = [
  { value: "internet", labelZh: "互联网", labelEn: "Internet" },
  {
    value: "software",
    labelZh: "软件与信息服务",
    labelEn: "Software & IT Services",
  },
  { value: "ai", labelZh: "人工智能", labelEn: "Artificial Intelligence" },
  { value: "finance", labelZh: "金融", labelEn: "Finance" },
  { value: "manufacturing", labelZh: "制造业", labelEn: "Manufacturing" },
  { value: "retail", labelZh: "零售与电商", labelEn: "Retail & E-commerce" },
  { value: "education", labelZh: "教育", labelEn: "Education" },
  { value: "healthcare", labelZh: "医疗健康", labelEn: "Healthcare" },
  {
    value: "government",
    labelZh: "政府与公共事业",
    labelEn: "Government & Public Sector",
  },
  { value: "energy", labelZh: "能源与化工", labelEn: "Energy & Chemicals" },
  {
    value: "transport",
    labelZh: "交通与物流",
    labelEn: "Transportation & Logistics",
  },
  {
    value: "real_estate",
    labelZh: "房地产与建筑",
    labelEn: "Real Estate & Construction",
  },
  { value: "media", labelZh: "文化传媒", labelEn: "Media & Entertainment" },
  {
    value: "professional_services",
    labelZh: "咨询与专业服务",
    labelEn: "Professional Services",
  },
  { value: "agriculture", labelZh: "农业", labelEn: "Agriculture" },
  { value: "other", labelZh: "其他", labelEn: "Other" },
] as const;

/** 写入校验:是否受管清单内的合法值。console-bff 写入面用它挡住自由输入。 */
export function isValidIndustry(value: string): value is Industry {
  return (INDUSTRIES as readonly string[]).includes(value);
}

/** 取展示标签(缺省 zh)。未登记值(历史自由文本)退回原字符串,显影而非静默。 */
export function industryLabel(
  value: string,
  locale: "zh" | "en" = "zh",
): string {
  const def = INDUSTRY_DEFS.find((d) => d.value === value);
  if (!def) return value;
  return locale === "en" ? def.labelEn : def.labelZh;
}
