/**
 * Architectural digital-twin artwork for an embodied-intelligence access gateway.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-15
 */

// ============================================================================
// Static scene primitives; no operational measurements or live-status claims
// ============================================================================
/** Render a workcell as a spatial model, rather than a generic technology motif. */
export function SpatialScene() {
  return (
    <svg
      className="embodied-spatial-svg"
      viewBox="0 0 1600 1000"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="spatial-sky" x2="1" y2="1">
          <stop stopColor="color-mix(in srgb, var(--vx-color-sky-950) 35%, var(--vx-color-neutral-900))" />
          <stop
            offset="1"
            stopColor="color-mix(in srgb, var(--vx-color-sky-950) 25%, var(--vx-color-black))"
          />
        </linearGradient>
        <linearGradient id="spatial-floor" x2="0" y2="1">
          <stop stopColor="color-mix(in srgb, var(--vx-color-sky-600) 20%, var(--vx-color-neutral-900))" />
          <stop
            offset="1"
            stopColor="color-mix(in srgb, var(--vx-color-sky-950) 25%, var(--vx-color-neutral-950))"
          />
        </linearGradient>
        <linearGradient id="spatial-metal" x1="0" x2="1">
          <stop stopColor="color-mix(in srgb, var(--vx-color-sky-950) 60%, var(--vx-color-neutral-600))" />
          <stop
            offset=".45"
            stopColor="color-mix(in srgb, var(--vx-color-sky-950) 45%, var(--vx-color-white))"
          />
          <stop
            offset=".62"
            stopColor="color-mix(in srgb, var(--vx-color-sky-950) 70%, var(--vx-color-white))"
          />
          <stop
            offset="1"
            stopColor="color-mix(in srgb, var(--vx-color-amber-900) 15%, var(--vx-color-sky-950))"
          />
        </linearGradient>
        <linearGradient id="spatial-arm" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="color-mix(in srgb, var(--vx-color-emerald-800) 35%, var(--vx-color-purple-100))" />
          <stop
            offset=".45"
            stopColor="color-mix(in srgb, var(--vx-color-sky-950) 75%, var(--vx-color-white))"
          />
          <stop
            offset="1"
            stopColor="color-mix(in srgb, var(--vx-color-amber-900) 15%, var(--vx-color-sky-950))"
          />
        </linearGradient>
        <radialGradient id="spatial-light">
          <stop
            stopColor="color-mix(in srgb, var(--vx-color-sky-100) 30%, var(--vx-color-sky-900))"
            stopOpacity=".35"
          />
          <stop
            offset="1"
            stopColor="color-mix(in srgb, var(--vx-color-sky-950) 55%, var(--vx-color-neutral-800))"
            stopOpacity="0"
          />
        </radialGradient>
        <linearGradient id="spatial-scan" x2="0" y2="1">
          <stop
            stopColor="color-mix(in srgb, var(--vx-color-emerald-400) 35%, var(--vx-color-brand-100))"
            stopOpacity=".01"
          />
          <stop
            offset="1"
            stopColor="color-mix(in srgb, var(--vx-color-emerald-400) 35%, var(--vx-color-brand-100))"
            stopOpacity=".18"
          />
        </linearGradient>
        <pattern
          id="spatial-dots"
          width="15"
          height="15"
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx="2"
            cy="2"
            r="1"
            fill="color-mix(in srgb, var(--vx-color-emerald-50) 60%, var(--vx-color-sky-800))"
            opacity=".45"
          />
        </pattern>
        <pattern
          id="spatial-wall"
          width="90"
          height="90"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M0 0H90V90"
            stroke="color-mix(in srgb, var(--vx-color-sky-950) 70%, var(--vx-color-brand-20))"
            strokeOpacity=".14"
          />
        </pattern>
        <filter id="spatial-glow">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <rect width="1600" height="1000" fill="url(#spatial-sky)" />
      <ellipse cx="830" cy="560" rx="780" ry="500" fill="url(#spatial-light)" />
      {/* Distant laboratory envelope gives the platform an industrial setting. */}
      <path d="M0 120 680 20 1600 170V720L0 770Z" fill="url(#spatial-wall)" />
      <g
        stroke="color-mix(in srgb, var(--vx-color-sky-900) 40%, var(--vx-color-neutral-400))"
        strokeOpacity=".15"
      >
        <path d="M0 220 680 125 1600 270M0 330 680 245 1600 380M680 20V650M1060 84V700M1370 135V730" />
        <path d="M790 100V490L1090 540V155M815 105V475L1065 515V150" />
        <path d="M1140 165V555L1450 610V220M1165 170V540L1425 585V215" />
      </g>
      <path
        d="M-200 705 745 390 1810 835 680 1250Z"
        fill="url(#spatial-floor)"
      />
      <g
        stroke="color-mix(in srgb, var(--vx-color-sky-900) 55%, var(--vx-color-neutral-100))"
        strokeOpacity=".14"
        strokeWidth="1"
      >
        {Array.from({ length: 19 }, (_, i) => (
          <path
            key={`axis-a-${i}`}
            d={`M${-700 + i * 100} 1070 ${340 + i * 75} 360`}
          />
        ))}
        {Array.from({ length: 16 }, (_, i) => (
          <path
            key={`axis-b-${i}`}
            d={`M${-180 + i * 30} ${480 + i * 38} ${1540 + i * 30} ${1070 + i * 38}`}
          />
        ))}
      </g>
      {/* The workcell is drawn as a static architectural model. */}
      <g
        stroke="color-mix(in srgb, var(--vx-color-sky-900) 55%, var(--vx-color-neutral-50))"
        strokeWidth="1"
      >
        <path
          d="m330 615 330-110 386 152-349 136Z"
          fill="color-mix(in srgb, var(--vx-color-amber-950) 45%, var(--vx-color-sky-800))"
          fillOpacity=".48"
        />
        <path
          d="M330 615v24l367 155 349-137v-24M697 770v24"
          strokeOpacity=".5"
        />
        <path
          d="m354 610 305-101 358 142-321 125Z"
          strokeDasharray="6 6"
          strokeOpacity=".5"
        />
      </g>
      <g
        stroke="color-mix(in srgb, var(--vx-color-amber-950) 40%, var(--vx-color-sky-300))"
        strokeOpacity=".45"
      >
        <path d="M355 609V356l307-102 354 143v252M355 356l354 143 307-102M709 499v271" />
        <path
          d="M355 356v-16m307-86v-16m354 159v-16M339 356h16m354 143h16"
          stroke="color-mix(in srgb, var(--vx-color-emerald-200) 85%, var(--vx-color-purple-600))"
        />
      </g>
      {/* Shelving, inspection table and spatial capture volume. */}
      <g>
        <path
          d="m802 512 90-31 105 43-91 34Z"
          fill="color-mix(in srgb, var(--vx-color-sky-900) 45%, var(--vx-color-neutral-500))"
        />
        <path
          d="M802 512v65l104 44v-63Z"
          fill="color-mix(in srgb, var(--vx-color-sky-950) 65%, var(--vx-color-neutral-600))"
        />
        <path
          d="m906 558 91-34v62l-91 35Z"
          fill="color-mix(in srgb, var(--vx-color-sky-950) 55%, var(--vx-color-neutral-800))"
        />
        <path
          d="m827 501 42-15 48 19-42 16Z"
          fill="color-mix(in srgb, var(--vx-color-sky-300) 25%, var(--vx-color-neutral-500))"
        />
        <path
          d="M827 501v27l48 20v-27Z"
          fill="color-mix(in srgb, var(--vx-color-sky-900) 35%, var(--vx-color-neutral-500))"
        />
        <path
          d="m875 521 42-16v27l-42 16Z"
          fill="color-mix(in srgb, var(--vx-color-sky-600) 20%, var(--vx-color-neutral-700))"
        />
        <path d="m800 511 88-190 110 203Z" fill="url(#spatial-scan)" />
        <path
          d="m800 511 88-190 110 203M888 321v208"
          stroke="color-mix(in srgb, var(--vx-color-emerald-400) 45%, var(--vx-color-purple-200))"
          strokeOpacity=".3"
          strokeDasharray="4 7"
        />
        <ellipse
          cx="888"
          cy="321"
          rx="12"
          ry="5"
          fill="color-mix(in srgb, var(--vx-color-emerald-600) 30%, var(--vx-color-sky-100))"
          fillOpacity=".65"
        />
        <path
          d="m795 516 101-34 111 43-103 40Z"
          stroke="color-mix(in srgb, var(--vx-color-amber-100) 65%, var(--vx-color-sky-500))"
          strokeOpacity=".7"
        />
      </g>
      <g opacity=".6">
        <path
          d="m1110 535 122-41 148 60-123 46Z"
          fill="color-mix(in srgb, var(--vx-color-sky-800) 35%, var(--vx-color-neutral-700))"
        />
        <path
          d="M1110 535V320l122-41 148 60v215M1257 600V382l123-43M1110 320l147 62"
          stroke="color-mix(in srgb, var(--vx-color-sky-300) 40%, var(--vx-color-neutral-700))"
        />
        <path
          d="m1110 390 147 63 123-46M1110 465l147 61 123-46"
          stroke="color-mix(in srgb, var(--vx-color-sky-300) 40%, var(--vx-color-neutral-700))"
        />
        <path
          d="m1130 369 50-17 43 17-50 18ZM1268 422l52-18 40 17-52 18Z"
          fill="color-mix(in srgb, var(--vx-color-sky-400) 10%, var(--vx-color-neutral-500))"
        />
        <path
          d="M1130 369v22l43 18v-22M1268 422v23l40 16v-22"
          stroke="color-mix(in srgb, var(--vx-color-sky-900) 30%, var(--vx-color-neutral-400))"
        />
      </g>
      {/* Ground the supplied robot in the central workcell's floor plane. */}
      <ellipse
        cx="715"
        cy="706"
        rx="72"
        ry="17"
        fill="color-mix(in srgb, var(--vx-color-sky-900) 15%, var(--vx-color-black))"
        opacity=".6"
      />
      <image
        className="embodied-humanoid-image"
        href="/images/agent-robot.png"
        x="590"
        y="355"
        width="300"
        height="350"
        preserveAspectRatio="xMidYMax meet"
      />
      {/* Mobile platform and dashed navigation path connect physical agents. */}
      <path
        d="m300 746 95-31 78 34-95 35Z"
        fill="color-mix(in srgb, var(--vx-color-emerald-50) 40%, var(--vx-color-sky-950))"
      />
      <path
        d="M300 746v39l78 32v-33Z"
        fill="color-mix(in srgb, var(--vx-color-sky-700) 30%, var(--vx-color-neutral-700))"
      />
      <path
        d="m378 784 95-35v39l-95 29Z"
        fill="color-mix(in srgb, var(--vx-color-sky-950) 65%, var(--vx-color-neutral-700))"
      />
      <path
        d="m323 740 49-16 47 20-49 17Z"
        fill="color-mix(in srgb, var(--vx-color-emerald-800) 35%, var(--vx-color-purple-100))"
      />
      <path
        d="M323 740v14l47 20v-13Z"
        fill="color-mix(in srgb, var(--vx-color-emerald-50) 45%, var(--vx-color-sky-950))"
      />
      <path
        d="M400 786l47-17"
        stroke="color-mix(in srgb, var(--vx-color-emerald-200) 85%, var(--vx-color-brand-300))"
        strokeWidth="3"
      />
      <ellipse
        cx="374"
        cy="733"
        rx="11"
        ry="5"
        fill="color-mix(in srgb, var(--vx-color-amber-900) 15%, var(--vx-color-sky-950))"
      />
      <path
        d="m460 789 133 56 206-78 118 48"
        stroke="color-mix(in srgb, var(--vx-color-emerald-500) 45%, var(--vx-color-purple-200))"
        strokeOpacity=".8"
        strokeWidth="2"
        strokeDasharray="8 8"
      />
      <path
        d="m900 801 17 14-24 1"
        stroke="color-mix(in srgb, var(--vx-color-emerald-500) 45%, var(--vx-color-purple-200))"
        strokeWidth="2"
      />
      <g
        stroke="color-mix(in srgb, var(--vx-color-emerald-600) 45%, var(--vx-color-purple-200))"
        strokeOpacity=".35"
      >
        <ellipse cx="378" cy="765" rx="140" ry="59" />
        <ellipse cx="378" cy="765" rx="170" ry="74" strokeDasharray="3 9" />
      </g>
      {/* Point-cloud boundary emphasizes spatial perception over generic AI imagery. */}
      <path
        d="m53 673 172-61 111 43v125l-172 64-111-50Z"
        fill="url(#spatial-dots)"
        opacity=".75"
      />
      <g
        stroke="color-mix(in srgb, var(--vx-color-sky-300) 40%, var(--vx-color-neutral-500))"
        strokeOpacity=".4"
        strokeWidth="1"
      >
        <path d="M67 670v-49h48M988 682h49v-49M320 825v35h45" />
        <path d="m72 841 79-26m-40 13v-36M111 828l29 12" />
      </g>
    </svg>
  );
}
