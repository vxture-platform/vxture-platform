/**
 * solutions.data.ts - 解决方案页的行业清单（结构数据，不含文案）
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Solutions
 * @author AI-Generated
 * @date 2026-08-22
 */

import type { IconName } from "@vxture/design-system";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Accent hue for one industry. Maps to `.vx-solutions-industry--{accent}` in
 * src/styles/website-marketing-assembly.css, which is where the actual colour
 * comes from — the value here is only the selector suffix.
 */
export type SolutionAccent = "sky" | "red" | "amber" | "emerald";

/**
 * 行业条目
 */
export interface SolutionIndustry {
  /** i18n key under `solutions.industries.*`; also the snap-section anchor id. */
  readonly id: string;
  /** URL segment under /solutions. */
  readonly slug: string;
  readonly icon: IconName;
  readonly accent: SolutionAccent;
  /**
   * Whether a written detail page exists. `false` renders the shared
   * "being written" detail page instead of a 404, so every 查看详情 stays live.
   */
  readonly hasDetail: boolean;
}

// ============================================================================
// 数据
// ============================================================================

/** 行业顺序即页面顺序。 */
export const SOLUTION_INDUSTRIES: readonly SolutionIndustry[] = [
  {
    id: "lowAltitude",
    slug: "low-altitude",
    icon: "paperplane-tilt",
    accent: "sky",
    hasDetail: false,
  },
  {
    id: "emergency",
    slug: "emergency",
    icon: "shield-warning",
    accent: "red",
    hasDetail: true,
  },
  {
    id: "energy",
    slug: "energy",
    icon: "lightning",
    accent: "amber",
    hasDetail: false,
  },
  {
    id: "industrial",
    slug: "industrial",
    icon: "cpu",
    accent: "emerald",
    hasDetail: false,
  },
];

/** Anchor id for the ecosystem section — the shared target of every 咨询 CTA fallback. */
export const SOLUTIONS_ECOSYSTEM_ID = "solution-section-bottom";

/** Anchor id of the hero section. */
export const SOLUTIONS_HERO_ID = "solution-section-hero";

/** Section anchor id for one industry, e.g. `solution-section-emergency`. */
export function solutionSectionId(slug: string): string {
  return `solution-section-${slug}`;
}

/** Look up an industry by its URL segment. */
export function findIndustryBySlug(slug: string): SolutionIndustry | undefined {
  return SOLUTION_INDUSTRIES.find((industry) => industry.slug === slug);
}
