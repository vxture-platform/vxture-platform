/**
 * pricing-model.ts — /pricing 页面数据适配层
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing / Pricing
 *
 * 页面所需的完整定价模型在这里收口：本轮数据仍来自 i18n
 * （products.subscription.products），下一步切换到
 * `GET /api/products/:code/plans` 时只替换 getPricingModel 的取数来源，
 * 页面与子组件不感知。
 *
 * 受众映射（tier → 个人/团队/私有化）是业务规则，属于代码而非文案，
 * 因此固定在本文件，不进 i18n。
 */

import { formatCurrency, type Locale } from "@vxture-platform/shared";

export type PlanAudience = "person" | "team" | "private";

export type BillingCycle = "monthly" | "yearly";

export interface PricingPlan {
  tier: string;
  name: string;
  tagline?: string;
  /** 月付价（CNY 整数）；null = 联系销售（企业版） */
  monthly: number | null;
  /** 年付价（CNY 整数）；null = 联系销售（企业版） */
  yearly: number | null;
  seats: string;
  features: string[];
  highlight?: boolean;
  audience: PlanAudience;
}

export interface ComparisonRow {
  label: string;
  /** 每档一列：true=✓，false=不含，字符串=具体额度 */
  values: (string | boolean)[];
}

export interface ComparisonGroup {
  title: string;
  rows: ComparisonRow[];
}

export interface PricingModel {
  code: string;
  name: string;
  /** 产品类型标签（平台/智能体…），plan bar 胶囊展示用 */
  kind: string;
  contactSubject: string;
  plans: PricingPlan[];
  comparison: { groups: ComparisonGroup[] };
}

/** i18n 侧的原始 plan 形状（无 audience，价格为数字） */
interface RawPlan {
  tier: string;
  name: string;
  tagline?: string;
  monthly: number | null;
  yearly: number | null;
  seats: string;
  features: string[];
  highlight?: boolean;
}

export interface RawSubscribableProduct {
  name: string;
  kind: string;
  contactSubject: string;
  plans: RawPlan[];
  comparison: { groups: ComparisonGroup[] };
}

/** tier → 受众。free/starter/pro 个人档，business 团队在线，enterprise 团队私有化。 */
const TIER_AUDIENCE: Record<string, PlanAudience> = {
  free: "person",
  starter: "person",
  pro: "person",
  business: "team",
  enterprise: "private",
};

export function getPricingModel(
  raw: Record<string, RawSubscribableProduct>,
  code: string,
): PricingModel | null {
  const product = raw[code];
  if (!product) return null;
  return {
    code,
    name: product.name,
    kind: product.kind,
    contactSubject: product.contactSubject,
    comparison: product.comparison,
    plans: product.plans.map((plan) => ({
      ...plan,
      audience: TIER_AUDIENCE[plan.tier] ?? "person",
    })),
  };
}

/**
 * 营销价展示：CNY 整数（¥1,999），走 @vxture-platform/shared 的 formatCurrency
 * （110-locale-layer 指定的唯一货币格式化入口），符号随 locale 本地化。
 */
export function formatCny(amount: number, locale: Locale): string {
  return formatCurrency(amount, locale, "CNY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** 年付相对月付的节省额与比例（仅对付费档有意义） */
export function yearlySavings(
  monthly: number,
  yearly: number,
): { save: number; percent: number } {
  const full = monthly * 12;
  const save = full - yearly;
  return { save, percent: full > 0 ? Math.round((save / full) * 100) : 0 };
}
