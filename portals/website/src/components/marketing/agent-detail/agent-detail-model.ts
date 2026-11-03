/**
 * Presentation model for catalog-driven agent introductions.
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing - View Model
 * @author AI-Generated
 * @date 2026-11-03
 */
import {
  catalogDisplayName,
  marketingForLocale,
  type ProductCatalogItem,
} from "@/api/product-catalog.api";

export interface AgentDetailContent {
  name: string;
  brand: string;
  tagline: string;
  lead: string;
  highlights: string[];
  paragraphs: string[];
  industries: string[];
  tags: string[];
  artwork: number;
}

export type AgentAvailability =
  | "maintenance"
  | "preview"
  | "sunset"
  | "available";

// Catalog content remains authoritative; no product-specific copy is synthesized.
function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/** @param product Catalog state. @returns Existing lifecycle priority for actions. */
export function agentAvailability(
  product: ProductCatalogItem,
): AgentAvailability {
  if (product.maintenance) return "maintenance";
  if (product.status === "developing" || product.releaseStage === "preview")
    return "preview";
  if (product.releaseStage === "sunset") return "sunset";
  return "available";
}

/** @param code Catalog identity. @returns A stable decorative variant across SSR and hydration. */
export function agentArtworkVariant(code: string): number {
  let hash = 0;
  for (const character of code)
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash % 3;
}

/** @param product Live catalog entry. @param locale Site locale. @returns Optional content without empty sections. */
export function buildAgentDetail(
  product: ProductCatalogItem,
  locale: string,
): AgentDetailContent {
  const marketing = marketingForLocale(product.marketing, locale);
  const name = catalogDisplayName(product, locale);
  const brand = product.productNick?.trim() || "";
  return {
    name,
    brand: brand !== name ? brand : "",
    tagline: marketing?.tagline?.trim() || "",
    lead: marketing?.value?.trim() || product.description?.trim() || "",
    highlights: cleanList(marketing?.highlights),
    paragraphs: (marketing?.detail || "")
      .split(/\r?\n\s*\r?\n/)
      .map((text) => text.trim())
      .filter(Boolean),
    industries: cleanList(marketing?.industries),
    tags: cleanList(marketing?.tags),
    artwork: agentArtworkVariant(product.productCode),
  };
}
