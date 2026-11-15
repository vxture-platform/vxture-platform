/**
 * Resolution-independent orbital sculpture for the research portal composition.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-15
 */
/** Render an abstract connection field without external assets or institution claims. */
export function ResearchArtwork() {
  return (
    <div className="research-art" aria-hidden="true">
      <div className="research-art-grid" />
      <svg viewBox="0 0 760 640" className="research-orbits" fill="none">
        <defs>
          <linearGradient
            id="orbit-light"
            x1="150"
            y1="90"
            x2="610"
            y2="540"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="color-mix(in srgb, var(--vx-color-sky-50) 85%, var(--vx-color-brand-500))" />
            <stop
              offset=".45"
              stopColor="color-mix(in srgb, var(--vx-color-white) 40%, var(--vx-color-brand-600))"
            />
            <stop
              offset="1"
              stopColor="color-mix(in srgb, var(--vx-color-neutral-500) 15%, var(--vx-color-brand-700))"
            />
          </linearGradient>
          <radialGradient id="orbit-core">
            <stop stopColor="var(--vx-color-brand-100)" stopOpacity=".42" />
            <stop
              offset="1"
              stopColor="color-mix(in srgb, var(--vx-color-brand-100) 50%, var(--vx-color-brand-600))"
              stopOpacity="0"
            />
          </radialGradient>
          <filter id="orbit-glow">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <circle cx="390" cy="324" r="220" fill="url(#orbit-core)" />
        <g stroke="url(#orbit-light)" strokeWidth="1.1">
          <ellipse
            cx="390"
            cy="324"
            rx="260"
            ry="108"
            transform="rotate(-35 390 324)"
          />
          <ellipse
            cx="390"
            cy="324"
            rx="260"
            ry="108"
            transform="rotate(35 390 324)"
          />
          <ellipse
            cx="390"
            cy="324"
            rx="260"
            ry="108"
            transform="rotate(90 390 324)"
          />
          <ellipse
            cx="390"
            cy="324"
            rx="217"
            ry="90"
            transform="rotate(-35 390 324)"
            opacity=".4"
          />
          <ellipse
            cx="390"
            cy="324"
            rx="217"
            ry="90"
            transform="rotate(35 390 324)"
            opacity=".4"
          />
          <ellipse
            cx="390"
            cy="324"
            rx="217"
            ry="90"
            transform="rotate(90 390 324)"
            opacity=".4"
          />
        </g>
        <g
          stroke="color-mix(in srgb, var(--vx-color-sky-300) 10%, var(--vx-color-brand-200))"
          strokeOpacity=".2"
        >
          <circle cx="390" cy="324" r="160" strokeDasharray="2 8" />
          <circle cx="390" cy="324" r="284" strokeDasharray="2 8" />
          <path d="M70 324h640M390 24v600" strokeDasharray="3 8" />
        </g>
        <g fill="color-mix(in srgb, var(--vx-color-sky-200) 10%, var(--vx-color-brand-100))">
          <circle cx="231" cy="174" r="5" />
          <circle cx="550" cy="472" r="4" />
          <circle cx="390" cy="64" r="4" />
          <circle cx="390" cy="324" r="7" />
          <circle cx="584" cy="215" r="3" />
        </g>
        <circle
          cx="390"
          cy="324"
          r="18"
          stroke="color-mix(in srgb, var(--vx-color-sky-50) 80%, var(--vx-color-brand-600))"
          strokeOpacity=".4"
        />
        <circle
          cx="390"
          cy="324"
          r="10"
          fill="color-mix(in srgb, var(--vx-color-sky-200) 10%, var(--vx-color-brand-100))"
          filter="url(#orbit-glow)"
        />
      </svg>
      <span className="research-art-caption">
        KNOWLEDGE · INTELLIGENCE · CONNECTION
      </span>
      <span className="research-art-coordinate">∞ POSSIBILITIES</span>
    </div>
  );
}
