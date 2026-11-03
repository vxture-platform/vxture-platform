"use client";

/**
 * Dedicated RUYIN product introduction within the existing website shell.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import {
  WorkbenchHero,
  WorkbenchFoundations,
  WorkbenchScenarios,
  WorkbenchTeams,
  WorkbenchPositioning,
  WorkbenchFaq,
} from "./workbench";

/** @returns The desktop product story, distinct from the agent catalog template. */
export function WorkbenchProductPage() {
  return (
    <div className="bg-background text-foreground">
      <WorkbenchHero />
      <WorkbenchFoundations />
      <WorkbenchScenarios />
      <WorkbenchTeams />
      <WorkbenchPositioning />
      <WorkbenchFaq />
    </div>
  );
}
