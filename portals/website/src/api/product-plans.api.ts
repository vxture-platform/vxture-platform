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
import {
  normalizeMaintenance,
  type ProductMaintenance,
} from "./product-catalog.api";

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
  /**
   * 该档的订阅入口（owner 2026-09-28）：public = 自助可买；invite = 凭邀请（运营定向
   * 发券、持券人登录 console 才看得到这一档）。档位卡据此换 CTA：「订阅」/「邀请订阅」。
   *
   * 部署偏斜防护：旧 BFF 不回这一列，回落 `public`——旧阶梯里本来就只有公开档。
   */
  access: "public" | "invite";
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
  /**
   * 承诺等级（preview / beta / stable / sunset，2026-09-27）：preview 走「暂未开放订阅」
   * 空态，sunset 阶梯照画但 CTA 换成「停售中」。
   *
   * 部署偏斜防护：旧 BFF 不回这一列时为 null——两种特殊呈现都不触发，即本字段之前的行为。
   */
  releaseStage: string | null;
}

export interface ProductPlansResponse {
  product: ProductPlansProduct | null;
  plans: ProductPlanOption[];
  /**
   * 订阅入口三态：public 阶梯里有公开档 / invite 只有邀请档 / none 一档都没有。
   * 2026-09-28 起邀请档也在 `plans` 里（各带 access），页面按档画 CTA；这一项留给
   * 目录卡与「一档都没有」的空态。
   *
   * 部署偏斜防护：旧响应没有这个字段时回落 `none`，即本字段之前的行为。
   */
  subscribeAccess: "public" | "invite" | "none";
  /**
   * 产品级升级维护窗口（owner 2026-09-27）；null = 不在维护中。与目录端点同一形状、同一
   * 真源。定价页据此把每张卡的 CTA 换成状态字「升级维护中，暂不可订阅」；`subscribeAccess`
   * 与阶梯照旧，维护不改变正常流程里的判定。部署偏斜：旧响应没有这一项时回落 null。
   */
  maintenance: ProductMaintenance | null;
}

/**
 * 部署偏斜防护：旧 BFF 的阶梯里只有公开档、没有 `access` 列，回落 `public`。只认明确的
 * `invite`——认不得的值按公开处理，与旧行为一致。
 */
function normalizePlan(raw: ProductPlanOption): ProductPlanOption {
  const access = (raw as { access?: unknown }).access;
  return { ...raw, access: access === "invite" ? "invite" : "public" };
}

export async function fetchProductPlans(
  code: string,
): Promise<ProductPlansResponse> {
  const res = await apiClient.get<ProductPlansResponse>(
    `/api/products/${encodeURIComponent(code)}/plans`,
  );
  const data = res.data;
  const access = (data as { subscribeAccess?: unknown } | undefined)
    ?.subscribeAccess;
  const product = data?.product ?? null;
  const stage = (product as { releaseStage?: unknown } | null)?.releaseStage;
  return {
    product: product
      ? { ...product, releaseStage: typeof stage === "string" ? stage : null }
      : null,
    plans: Array.isArray(data?.plans) ? data.plans.map(normalizePlan) : [],
    subscribeAccess:
      access === "public" || access === "invite" || access === "none"
        ? access
        : "none",
    maintenance: normalizeMaintenance(
      (data as { maintenance?: unknown } | undefined)?.maintenance,
    ),
  };
}
