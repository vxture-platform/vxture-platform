import { AgentMarketplacePage } from "@/components/marketing";
import {
  fetchPublicProductCatalogOrNull,
  isAgentProduct,
} from "@/api/product-catalog.api";

/*
 * /appcenter —— 智能体清单来自公开产品目录，逐请求取；页面只画目录里
 * product_type='agent' 的产品。目录读不到时传 null，由页面渲染不可用态。
 */
export const dynamic = "force-dynamic";

export default async function AppCenterPage() {
  const catalog = await fetchPublicProductCatalogOrNull();
  return (
    <AgentMarketplacePage
      agents={catalog ? catalog.filter(isAgentProduct) : null}
    />
  );
}
