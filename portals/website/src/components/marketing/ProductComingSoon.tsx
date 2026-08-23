"use client";

/**
 * ProductComingSoon.tsx - 平台级产品详情占位（product_320 §4.5）
 *
 * L1/L2 产品的独立介绍页先占位；arda 走真实详情 ProductDetailPartOne。
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

import { useTranslations } from "next-intl";
import type { IconName } from "@vxture/design-system";
import ComingSoonPage from "./ComingSoonPage";

type CatalogItem = {
  code: string;
  name: string;
  description: string;
  icon?: IconName;
};

export default function ProductComingSoon({ code }: { code: string }) {
  const t = useTranslations("products");
  const items = t.raw("catalog.items") as CatalogItem[];
  const item = items.find((i) => i.code === code);

  return (
    <ComingSoonPage
      icon={item?.icon ?? "cube"}
      accent="brand"
      eyebrow={t("catalog.eyebrow")}
      title={item?.name ?? code}
      subtitle={t("catalog.comingSoonHint")}
      description={item?.description ?? ""}
      primaryAction={{ href: "/contact", label: t("catalog.consult") }}
      backAction={{ href: "/products", label: t("catalog.back") }}
    />
  );
}
