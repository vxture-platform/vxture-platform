/**
 * Lightweight geometric artwork selected by catalog identity.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
/** @param props Stable variant. @returns Decorative geometry that follows DS colors. */
export function AgentHeroArtwork({ variant }: { variant: number }) {
  return (
    <svg
      viewBox="0 0 560 480"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full text-primary-text"
    >
      <g stroke="currentColor" strokeWidth="1" opacity="0.18">
        {variant === 0 ? (
          <>
            {[100, 150, 200, 245].map((radius) => (
              <circle key={radius} cx="280" cy="240" r={radius} />
            ))}
            <ellipse
              cx="280"
              cy="240"
              rx="260"
              ry="120"
              transform="rotate(-32 280 240)"
            />
            <ellipse
              cx="280"
              cy="240"
              rx="260"
              ry="120"
              transform="rotate(32 280 240)"
            />
            <path d="M35 240h490M280 0v480" strokeDasharray="3 9" />
          </>
        ) : variant === 1 ? (
          <>
            {[0, 1, 2, 3, 4, 5, 6].map((step) => (
              <ellipse
                key={step}
                cx="280"
                cy="240"
                rx={110 + step * 23}
                ry={65 + step * 22}
                transform="rotate(-30 280 240)"
              />
            ))}
            <path d="M50 400 510 80M90 440 470 40" strokeDasharray="3 9" />
          </>
        ) : (
          <>
            {[0, 1, 2, 3, 4].map((step) => (
              <rect
                key={step}
                x={100 + step * 24}
                y={60 + step * 24}
                width={360 - step * 48}
                height={360 - step * 48}
                rx="40"
                transform="rotate(-25 280 240)"
              />
            ))}
            <path d="M20 120 540 360M20 360 540 120" strokeDasharray="3 9" />
          </>
        )}
      </g>
      <g fill="currentColor" opacity="0.55">
        <circle cx="115" cy="112" r="4" />
        <circle cx="465" cy="325" r="5" />
        <circle cx="175" cy="407" r="3" />
        <circle cx="425" cy="80" r="3" />
      </g>
    </svg>
  );
}
