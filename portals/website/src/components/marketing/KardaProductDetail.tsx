"use client";

/**
 * Karda product introduction, composed with the shared website shell and DS.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import {
  KardaCapabilities,
  KardaKnowledgeFlow,
  KardaHero,
  KardaTeamsAndFaq,
} from "./karda";

/** @returns The Karda introduction without a duplicate header or theme state. */
export function KardaProductDetail() {
  return (
    <div className="bg-background text-foreground">
      <KardaHero />
      <KardaCapabilities />
      <KardaKnowledgeFlow />
      <KardaTeamsAndFaq />
    </div>
  );
}
