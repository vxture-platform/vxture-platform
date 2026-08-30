import { ProductsOverviewPage } from "@/components/marketing";
import {
  fetchPublicProductCatalogOrNull,
  isPlatformProduct,
} from "@/api/product-catalog.api";

/*
 * /products —— 清单来自公开产品目录，逐请求取；页面只画目录里的平台级产品
 * （product_type 四型，opera/40-product-registry.md §3）。目录读不到时传 null，
 * 由页面渲染「目录暂时不可用」而不是整页 500。
 */
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const catalog = await fetchPublicProductCatalogOrNull();
  return (
    <ProductsOverviewPage
      products={catalog ? catalog.filter(isPlatformProduct) : null}
    />
  );
}
