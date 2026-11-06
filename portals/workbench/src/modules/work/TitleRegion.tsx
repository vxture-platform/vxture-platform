/**
 * Consistent greeting and right-side title artwork on both workspace pages.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import { dailyPresentation } from "../../lib/presentation";
import type { HomeCopy } from "../../lib/presentation";

// ============================================================================
// Presentation composition
// ============================================================================
/**
 * Render the shared title region without route-dependent artwork scaling.
 * @param props - Current identity, clock and editable home copy.
 * @returns The page greeting, date and title.
 */
export function TitleRegion({
  name,
  now,
  copy,
  apps,
}: {
  name: string;
  now: Date;
  copy: HomeCopy;
  apps: boolean;
}): React.JSX.Element {
  const day = dailyPresentation(now, copy);
  return (
    <section className="work-title-region" aria-labelledby="page-title">
      <div className="work-context-row">
        <p className="work-greeting">
          {day.greeting} <span>@ {name}</span>
        </p>
        <p className="work-date">
          <span>{day.date}</span>
          <span>{day.weekday}</span>
        </p>
      </div>
      <div className="relative">
        <h1 id="page-title">{apps ? "专业所长，皆为所用" : day.title}</h1>
        <p className="work-title-description">
          {apps
            ? "找到适合当前业务的应用，直接开始工作"
            : "让专业融入日常，让每一步更有方向"}
        </p>
      </div>
      <svg
        className="work-title-art"
        viewBox="0 0 360 144"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <g
          stroke="currentColor"
          opacity=".16"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 105h64c20 0 18-42 40-42h34M80 127h48c18 0 21-21 39-21h32" />
          <path d="M104 28h37c18 0 17 19 34 19h22" strokeDasharray="3 6" />
          <circle cx="18" cy="105" r="3" />
          <circle cx="80" cy="127" r="3" />
        </g>
        <g fill="currentColor" opacity=".025">
          <rect x="218" y="12" width="124" height="86" rx="12" />
          <rect x="186" y="30" width="124" height="86" rx="12" />
          <rect x="154" y="48" width="124" height="86" rx="12" />
        </g>
        <g stroke="currentColor" opacity=".18" strokeLinecap="round">
          <rect x="218" y="12" width="124" height="86" rx="12" />
          <rect x="186" y="30" width="124" height="86" rx="12" />
          <rect x="154" y="48" width="124" height="86" rx="12" />
          <path d="M154 70h124M170 86h44M170 98h76M170 110h54M319 118h10m-5-5v10" />
        </g>
      </svg>
    </section>
  );
}
