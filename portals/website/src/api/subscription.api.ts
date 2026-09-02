/**
 * subscription.api.ts - 订阅态读取（website 侧）
 * @package @vxture/website
 * @layer Presentation
 * @category API
 *
 * 读当前登录租户各产品的代表订阅态，驱动产品卡片的 已开通/升级/进入 分支
 * （product_320 §4.5）。未登录时 BFF 返回 []。
 */

import { apiClient } from "./client";

export interface ProductSubscriptionState {
  productCode: string;
  subscribed: boolean;
  tier: string | null;
  status: string;
  /** 产品自己的工作台入口（product_webhooks.home_url）；未登记为 null → 退回 console 应用中心。 */
  homeUrl: string | null;
  /** 当前档之上还有可售档位才给「升级」。 */
  canUpgrade: boolean;
}

export async function fetchProductSubscriptions(): Promise<
  ProductSubscriptionState[]
> {
  const res = await apiClient.get<ProductSubscriptionState[]>(
    "/api/me/product-subscriptions",
  );
  return Array.isArray(res.data) ? res.data : [];
}
