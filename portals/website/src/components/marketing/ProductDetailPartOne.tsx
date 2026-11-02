"use client";

/**
 * Arda product introduction, composed with the shared website shell and DS.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import {
  ArdaCapabilities,
  ArdaDataFlow,
  ArdaHero,
  ArdaTeamsAndFaq,
} from "./arda";

/** @returns The Arda introduction without a duplicate header or theme state. */
export default function ProductDetailPartOne() {
  return (
    <div className="bg-background text-foreground">
      <ArdaHero />
      <ArdaCapabilities />
      <ArdaDataFlow />
      <ArdaTeamsAndFaq />
    </div>
  );
}
