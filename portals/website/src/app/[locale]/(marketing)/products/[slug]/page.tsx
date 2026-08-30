import { notFound } from "next/navigation";
import {
  ProductComingSoon,
  ProductDetailPartOne,
} from "@/components/marketing";
import { fetchPublicProductCatalog } from "@/api/product-catalog.api";

/*
 * /products/[slug] —— 有没有这个产品，由公开产品目录说了算。
 *
 * 此前这里有一份 KNOWN_PRODUCTS 硬编码集合，里面的 ontos / terra 在目录里根本不存在
 * （规划产品，opera/40-product-registry.md §5 D2），官网却替它们开着「敬请期待」页——
 * 那是在宣传平台没有的产品。2026-08-31 起：slug 在目录里 → 渲染（arda 有成稿详情，
 * 其余目录产品走占位页）；不在目录里 → notFound()，是真正的 404 状态码。
 *
 * 逐请求取目录（force-dynamic）：目录一变，官网同一秒跟着变，不留"上线了官网还 404"
 * 的窗口。目录读不到时不伪装成 404——错误冒出去是 500，与"不存在"是两回事。
 */
export const dynamic = "force-dynamic";

/** 唯一有成稿详情页的产品；目录里其余产品走 ProductComingSoon。 */
const DETAILED_PRODUCT = "arda";

interface ProductDetailRouteProps {
  params: Promise<{ slug: string }>;
}

export default async function ProductDetailRoute({
  params,
}: ProductDetailRouteProps) {
  const { slug } = await params;
  const catalog = await fetchPublicProductCatalog();
  const product = catalog.find((item) => item.productCode === slug);
  if (!product) notFound();
  if (product.productCode === DETAILED_PRODUCT) return <ProductDetailPartOne />;
  return <ProductComingSoon product={product} />;
}
