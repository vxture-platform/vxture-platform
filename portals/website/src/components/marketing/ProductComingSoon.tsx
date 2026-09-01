"use client";

/**
 * ProductComingSoon.tsx - 目录产品的详情占位页（product_320 §4.5）
 *
 * 目录里有、官网还没有成稿详情的产品落在这里；arda 走真实详情 ProductDetailPartOne。
 * 进来的一定是目录产品（/products/[slug] 已按公开目录裁定过存在性），名 / 类型 /
 * 描述取目录真列，营销文案（品牌名、图标、描述）按 product_code 到 products.json
 * `catalog.items` 里找，找不到就退回目录里的值——没有文案不等于没有产品。
 *
 * 形状由共享的 ComingSoonPage 给出——全站占位页只有一种长相（owner 2026-08-23
 * 定：不容许两套）。本件此前是自成一套的窄版居中排版，已退役。
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-08-23
 */

import { useLocale, useTranslations } from "next-intl";
import {
  catalogDisplayName,
  isAgentProduct,
  marketingForLocale,
  type ProductCatalogItem,
} from "@/api/product-catalog.api";
import ComingSoonPage from "./ComingSoonPage";
import { productTypeIcon, productTypeKey } from "./product-catalog-view";

interface ProductComingSoonProps {
  readonly product: ProductCatalogItem;
}

export default function ProductComingSoon({ product }: ProductComingSoonProps) {
  const t = useTranslations("products");
  const locale = useLocale();
  const m = marketingForLocale(product.marketing, locale);
  // 智能体回智能体广场，其余回产品矩阵——按目录类型分流，与两张清单页的口径一致。
  const backAction = isAgentProduct(product)
    ? { href: "/appcenter", label: t("catalog.backAppcenter") }
    : { href: "/products", label: t("catalog.back") };

  return (
    <ComingSoonPage
      icon={productTypeIcon(product.productType)}
      accent="brand"
      eyebrow={
        m?.tagline ?? t(`catalog.types.${productTypeKey(product.productType)}`)
      }
      title={catalogDisplayName(product, locale)}
      subtitle={t("catalog.comingSoonHint")}
      description={m?.value ?? product.description ?? ""}
      primaryAction={{ href: "/contact", label: t("catalog.consult") }}
      backAction={backAction}
    />
  );
}
