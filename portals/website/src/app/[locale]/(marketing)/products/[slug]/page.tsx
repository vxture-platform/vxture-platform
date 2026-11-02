import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import {
  AgentProductDetail,
  KardaProductDetail,
  ProductComingSoon,
  ProductDetailPartOne,
} from "@/components/marketing";
import {
  fetchPublicProductCatalog,
  isAgentProduct,
} from "@/api/product-catalog.api";

/*
 * Product existence comes from the live public catalog, never a hardcoded list.
 * Arda and Karda have bespoke introductions; other platform entries use placeholders.
 * Resolve on every request so newly listed products are immediately available.
 * Missing entries return 404; catalog failures propagate as errors, not false 404s.
 */
export const dynamic = "force-dynamic";

/**
 * 有**单独设计**详情页的 L1/L2 产品。
 *
 * owner 2026-09-14 定的分层:L1/L2 的平台产品「本身就不能简单地 marketing 渲染出介绍
 * 页面……页面需要单独设计和更新，这个可以走代码级修改发布」。所以这张表是有意的，不是债
 * ——它记的是「哪些产品已经有成稿页」，而不是「哪些产品被允许有页」。
 *
 * **L3 智能体不进这张表，永远不进。** 它们会越来越多，每接一个写一页不可持续，所以走
 * `AgentProductDetail` 由登记内容驱动。判族用 `isAgentProduct()`（按 `_agent` 后缀），
 * 不是点名——新增一个智能体子型这里也不用改。
 */
const BESPOKE_DETAIL_PAGES: Readonly<Record<string, () => ReactElement>> = {
  arda: ProductDetailPartOne,
  karda: KardaProductDetail,
};

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

  /* L3 智能体:整页由登记的营销内容驱动，接一个新的不需要改这里一个字。 */
  if (isAgentProduct(product)) return <AgentProductDetail product={product} />;

  /* L1/L2:有成稿页就渲染，没有才落占位。占位不是终点，是「这一页还没设计」。 */
  const Bespoke = BESPOKE_DETAIL_PAGES[product.productCode];
  if (Bespoke) return <Bespoke />;
  return <ProductComingSoon product={product} />;
}
