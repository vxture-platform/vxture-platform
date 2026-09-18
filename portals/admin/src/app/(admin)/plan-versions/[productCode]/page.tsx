import { PlanPublishingDetailPage } from "@/modules/products/PlanPublishingDetailPage";

/* 路由参数是**产品码**（`product_code`，如 `karda`），不是 UUID——地址栏是可见面，
   UUID 不在任何场景对外展示。与 /products/[productCode] 同一口径。 */
export default async function Page({
  params,
}: {
  params: Promise<{
    productCode: string;
  }>;
}) {
  const { productCode } = await params;
  return (
    <PlanPublishingDetailPage productCode={decodeURIComponent(productCode)} />
  );
}
