import { notFound } from "next/navigation";
import {
  ProductComingSoon,
  ProductDetailPartOne,
} from "@/components/marketing";

// 已知平台级产品 code（product_320 §4.5）；arda 有真实详情，其余占位。
const KNOWN_PRODUCTS = new Set([
  "arda",
  "atlas",
  "ontos",
  "runos",
  "karda",
  "terra",
]);

interface ProductDetailRouteProps {
  params: { slug: string };
}

export default function ProductDetailRoute({
  params,
}: ProductDetailRouteProps) {
  const { slug } = params;
  if (!KNOWN_PRODUCTS.has(slug)) notFound();
  if (slug === "arda") return <ProductDetailPartOne />;
  return <ProductComingSoon code={slug} />;
}
