/**
 * Protects lifecycle restrictions and sparse catalog content during layout changes.
 * @package @vxture/website
 * @layer Presentation
 * @category Marketing - Tests
 * @author AI-Generated
 * @date 2026-11-03
 */
import { describe, expect, it } from "vitest";
import type { ProductCatalogItem } from "@/api/product-catalog.api";
import {
  agentAvailability,
  agentArtworkVariant,
  buildAgentDetail,
} from "./agent-detail-model";

// Catalog fixture and lifecycle regressions
const product: ProductCatalogItem = {
  productCode: "new-agent",
  productName: "新智能体",
  productNick: "New Agent",
  productType: "future_agent",
  iconUrl: null,
  description: "目录描述",
  status: "active",
  releaseStage: "stable",
  releaseVersion: null,
  releasedAt: null,
  marketing: null,
  subscribeAccess: "public",
  hasPublicTier: true,
  hasInviteTier: false,
  maintenance: null,
};

describe("agent detail availability", () => {
  it.each([
    [
      {
        maintenance: { until: "2030-01-01" },
        status: "developing",
        releaseStage: "sunset",
      },
      "maintenance",
    ],
    [{ status: "developing", releaseStage: "stable" }, "preview"],
    [{ status: "active", releaseStage: "preview" }, "preview"],
    [{ releaseStage: "sunset" }, "sunset"],
    [{ releaseStage: "beta" }, "available"],
    [{ releaseStage: "stable" }, "available"],
  ] as const)("preserves action priority for %j", (state, expected) => {
    expect(agentAvailability({ ...product, ...state })).toBe(expected);
  });
});

// Content normalization and hydration-stable decoration
describe("catalog-driven content", () => {
  it("supports new agent types and missing marketing without invented sections", () => {
    const content = buildAgentDetail(product, "zh-CN");
    expect(content).toMatchObject({
      name: "新智能体",
      brand: "New Agent",
      lead: "目录描述",
      highlights: [],
      paragraphs: [],
      tags: [],
      industries: [],
    });
  });
  it("retains registered text while removing blank and repeated labels", () => {
    const content = buildAgentDetail(
      {
        ...product,
        marketing: {
          zh: {
            value: "  原始价值说明  ",
            detail: "第一段\r\n\r\n第二段\n\n第三段",
            highlights: ["  能力 A  ", "", "能力 A", "能力 B"],
            tags: ["标签"],
          },
        },
      },
      "zh-CN",
    );
    expect(content.lead).toBe("原始价值说明");
    expect(content.highlights).toEqual(["能力 A", "能力 B"]);
    expect(content.paragraphs).toEqual(["第一段", "第二段", "第三段"]);
  });
  it("uses the existing language fallback and does not repeat the same brand", () => {
    const content = buildAgentDetail(
      { ...product, marketing: { zh: { value: "中文回退" } } },
      "en-US",
    );
    expect(content.name).toBe("New Agent");
    expect(content.brand).toBe("");
    expect(content.lead).toBe("中文回退");
  });
  it("keeps background identity stable across locale and repeated rendering", () => {
    const variants = new Set(
      ["alpha", "beta", "gamma", "delta"].map(agentArtworkVariant),
    );
    expect(variants.size).toBeGreaterThan(1);
    expect([...variants].every((variant) => variant >= 0 && variant < 3)).toBe(
      true,
    );
    expect(buildAgentDetail(product, "zh-CN").artwork).toBe(
      buildAgentDetail(product, "en-US").artwork,
    );
    expect(agentArtworkVariant(product.productCode)).toBe(
      agentArtworkVariant(product.productCode),
    );
  });
});
