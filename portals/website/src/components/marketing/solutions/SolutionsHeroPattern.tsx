/**
 * SolutionsHeroPattern.tsx - 解决方案 Hero 右侧的大型几何图案
 *
 * A wireframe sphere (latitudes + longitudes) inside two tilted orbit rings:
 * many industries converging on one foundation. Purely decorative, so it is
 * `aria-hidden` and carries no text.
 *
 * Colour comes from the CSS `color` of `.vx-solutions-hero-pattern` and from
 * `.vx-solutions-pattern-accent` on the inner group — every stroke here is
 * `currentColor`, so light/dark and brand changes are handled by tokens alone.
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Solutions
 * @author AI-Generated
 * @date 2026-08-22
 */

const VIEWBOX = 640;
const CENTER = VIEWBOX / 2;
const RADIUS = 232;

/** Latitude rings: horizontal slices of the sphere, squashed by perspective. */
const LATITUDE_STEPS = [-0.78, -0.52, -0.26, 0, 0.26, 0.52, 0.78];

/** Longitude rings: vertical slices, drawn as ellipses of decreasing width. */
const LONGITUDE_STEPS = [1, 0.76, 0.48, 0.16];

/** Nodes pinned to the sphere, in (angle°, radius fraction) pairs. */
const NODES: ReadonlyArray<readonly [number, number]> = [
  [18, 0.82],
  [66, 0.46],
  [128, 0.9],
  [196, 0.62],
  [252, 0.88],
  [312, 0.34],
];

export default function SolutionsHeroPattern() {
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="h-auto w-full"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Outer orbits — the accent hue, so the mark is not flat monochrome. */}
      <g
        className="vx-solutions-pattern-accent"
        stroke="currentColor"
        strokeWidth={1.4}
      >
        <ellipse
          cx={CENTER}
          cy={CENTER}
          rx={RADIUS * 1.42}
          ry={RADIUS * 0.46}
          transform={`rotate(-22 ${CENTER} ${CENTER})`}
        />
        <ellipse
          cx={CENTER}
          cy={CENTER}
          rx={RADIUS * 1.28}
          ry={RADIUS * 0.3}
          transform={`rotate(24 ${CENTER} ${CENTER})`}
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS * 1.12}
          strokeDasharray="2 10"
        />
      </g>

      {/* Sphere wireframe. */}
      <g stroke="currentColor" strokeWidth={1.2}>
        <circle cx={CENTER} cy={CENTER} r={RADIUS} />

        {LATITUDE_STEPS.map((step) => {
          const cy = CENTER + RADIUS * step;
          const rx = RADIUS * Math.sqrt(Math.max(0, 1 - step * step));
          return (
            <ellipse
              key={`lat-${step}`}
              cx={CENTER}
              cy={cy}
              rx={rx}
              ry={rx * 0.2}
            />
          );
        })}

        {LONGITUDE_STEPS.map((step) => (
          <ellipse
            key={`lon-${step}`}
            cx={CENTER}
            cy={CENTER}
            rx={RADIUS * step}
            ry={RADIUS}
          />
        ))}
      </g>

      {/* Convergence nodes and their tie-lines back to the core. */}
      <g stroke="currentColor" strokeWidth={1} opacity={0.75}>
        {NODES.map(([angle, fraction]) => {
          const radians = (angle * Math.PI) / 180;
          const x = CENTER + Math.cos(radians) * RADIUS * fraction;
          const y = CENTER + Math.sin(radians) * RADIUS * fraction * 0.86;
          return (
            <line key={`line-${angle}`} x1={CENTER} y1={CENTER} x2={x} y2={y} />
          );
        })}
      </g>
      <g fill="currentColor">
        {NODES.map(([angle, fraction]) => {
          const radians = (angle * Math.PI) / 180;
          const x = CENTER + Math.cos(radians) * RADIUS * fraction;
          const y = CENTER + Math.sin(radians) * RADIUS * fraction * 0.86;
          return <circle key={`node-${angle}`} cx={x} cy={y} r={4.5} />;
        })}
        <circle cx={CENTER} cy={CENTER} r={7} />
      </g>
    </svg>
  );
}
