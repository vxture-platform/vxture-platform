/**
 * product-plans.api.ts - 公开套餐阶梯读取（website 侧）
 * @package @vxture/website
 * @layer Presentation
 * @category API
 *
 * 读单产品的公开套餐阶梯（档位 × 周期价 × 权益键 × 配额），驱动 /pricing。
 * 真源是 website-bff `GET /api/products/:code/plans`（product.plans /
 * plan_versions / plan_prices / plan_components），2026-08-30 起替代此前
 * 写死在 i18n 里的价目表。公开端点，匿名可读。
 *
 * 形状与 bff/website-bff/src/routers/product-plans.router.ts 的
 * ProductPlansResponse 逐字段对应；BFF 的容错契约是「产品不存在/不可见/无已
 * 发布套餐 → { product: null | …, plans: [] }」，所以这里只需守住形状。
 */

import { apiClient } from "./client";

export interface ProductPlanPrice {
  /** plan_prices.cycle_unit：day | week | month | year | perpetual */
  cycleUnit: string;
  cycleCount: number;
  /** 定价字符串（FM999999999990.00），避免浮点漂移；展示前再转数值 */
  price: string;
  currency: string;
}

export interface ProductPlanOption {
  planCode: string;
  planName: string;
  description: string | null;
  tier: string;
  /** 该档开放功能键（plan_components.features），展示文案由前端 i18n 映射 */
  features: string[];
  /** 该档配额键值（plan_components.quota 原样透传） */
  quota: Record<string, unknown> | null;
  /** 席位数（quota["member.max"]；-1 = 不限，无该指标 → null） */
  seats: number | null;
  prices: ProductPlanPrice[];
}

export interface ProductPlansProduct {
  code: string;
  name: string;
  nick: string | null;
  releaseVersion: string | null;
}

export interface ProductPlansResponse {
  product: ProductPlansProduct | null;
  plans: ProductPlanOption[];
}

export async function fetchProductPlans(
  code: string,
): Promise<ProductPlansResponse> {
  const res = await apiClient.get<ProductPlansResponse>(
    `/api/products/${encodeURIComponent(code)}/plans`,
  );
  const data = res.data;
  return {
    product: data?.product ?? null,
    plans: Array.isArray(data?.plans) ? data.plans : [],
  };
}
