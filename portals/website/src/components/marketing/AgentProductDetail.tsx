"use client";

/**
 * Shared, catalog-driven introduction for every agent product.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useState } from "react";
import { useLocale } from "next-intl";
import type { ProductCatalogItem } from "@/api/product-catalog.api";
import {
  AgentCapabilities,
  AgentIntroduction,
  AgentProductClosing,
  AgentProductHero,
  AgentProductMaintenance,
  buildAgentDetail,
} from "./agent-detail";

/** @param props Live catalog entry. @returns A shared agent product introduction. */
export default function AgentProductDetail({
  product,
}: {
  readonly product: ProductCatalogItem;
}) {
  const locale = useLocale();
  const content = buildAgentDetail(product, locale);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const openMaintenance = () => setMaintenanceOpen(true);
  return (
    <div className="bg-background text-foreground">
      <AgentProductHero
        product={product}
        content={content}
        onMaintenance={openMaintenance}
      />
      <AgentCapabilities highlights={content.highlights} />
      <AgentIntroduction content={content} />
      <AgentProductClosing product={product} onMaintenance={openMaintenance} />
      {product.maintenance ? (
        <AgentProductMaintenance
          maintenance={product.maintenance}
          open={maintenanceOpen}
          onOpenChange={setMaintenanceOpen}
        />
      ) : null}
    </div>
  );
}
