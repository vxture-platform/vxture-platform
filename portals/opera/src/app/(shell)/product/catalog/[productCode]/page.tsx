/* 产品详情 — opera 的第一个动态详情路由。
 *
 * 地址走**可读码**（`/product/catalog/karda`）而不是 uuid：地址要能读、能分享、
 * 能粘进工单。BFF 的 `GET :idOrCode` 双接受，先判形状再决定查哪一列。
 *
 * 这一层只解参数，内容全在 `ProductDetailPage`——与 admin 的详情路由同一分工
 * （路由文件薄、页面组件住在 modules/features 下），这样组件可被别处复用，也不必
 * 为了看一眼实现去翻 app/ 目录树。 */

import { ProductDetailPage } from "@/features/product/ProductDetailPage";

export default async function Page({
  params,
}: {
  params: Promise<{ productCode: string }>;
}) {
  const { productCode } = await params;
  return <ProductDetailPage productCode={decodeURIComponent(productCode)} />;
}
