import { ProductMarketingPage } from "@/modules/products/ProductMarketingPage";

/* 营销配置是与产品详情**同级**的二级页，不是它的子页——路由上是
   /products/<code>/marketing，但两者互为跳转、各自有面包屑回产品目录
   （owner 2026-09-21）。 */
export default async function Page({
  params,
}: {
  params: Promise<{
    productCode: string;
  }>;
}) {
  const { productCode } = await params;
  return <ProductMarketingPage productCode={decodeURIComponent(productCode)} />;
}
