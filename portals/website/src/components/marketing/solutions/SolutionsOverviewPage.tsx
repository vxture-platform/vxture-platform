"use client";

/**
 * SolutionsOverviewPage.tsx - /solutions 汇总页
 *
 * Hero + one full-viewport section per industry + the ecosystem closer. Scroll
 * snapping reuses the home page hook and its `.snap-section` contract, so both
 * pages behave the same way.
 *
 * The page itself carries no industry-specific naming beyond the shared data
 * list — each industry owns its own detail route under /solutions/{slug}.
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Solutions
 * @author AI-Generated
 * @date 2026-08-22
 */

import { useWindowScrollSnap } from "@/hooks";
import { SOLUTION_INDUSTRIES } from "@/data/solutions/solutions.data";
import ScrollToButton from "../ScrollToButton";
import SolutionsHeroSection from "./SolutionsHeroSection";
import SolutionIndustrySection from "./SolutionIndustrySection";
import SolutionsEcosystemSection from "./SolutionsEcosystemSection";

/** Same tuning as the home page — sections are viewport-height there too. */
const SNAP_THRESHOLD = 280;

export default function SolutionsOverviewPage() {
  const { snapToTarget } = useWindowScrollSnap({
    debugFlag: false,
    targetSelector: ".snap-section",
    targetAlignTo: "top",
    snapThreshold: SNAP_THRESHOLD,
    enabledDirections: ["up", "down"],
  });

  return (
    <div className="vx-page-surface relative">
      <SolutionsHeroSection />

      {SOLUTION_INDUSTRIES.map((industry, index) => (
        <SolutionIndustrySection
          key={industry.id}
          industry={industry}
          index={index}
        />
      ))}

      <SolutionsEcosystemSection />

      <ScrollToButton snapToTarget={snapToTarget} />
    </div>
  );
}
