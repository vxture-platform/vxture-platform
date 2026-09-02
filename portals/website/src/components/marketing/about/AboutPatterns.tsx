/**
 * AboutPatterns.tsx - 关于我们三屏各自的装饰图案（owner 2026-09-03：每个图案都不一样）
 *
 * 三张纯装饰 SVG，全部 `aria-hidden`、无文字，笔画一律 currentColor：颜色由容器的
 * CSS `color`（.vx-solutions-hero-pattern / .vx-about-pattern-*）和内层
 * `.vx-solutions-pattern-accent` 给，明暗与品牌换色只靠令牌。
 *
 *   · RadarPattern —— 01 定位：同心圆 + 刻度 + 扫描扇面 + 汇聚节点，「关注业务现场的信号」
 *   · PathPattern  —— 02 方法：点阵上的阶梯路径，四个节点，「从场景到智能体的落地路径」
 *   · StackPattern —— 03 能力：四层等轴测叠板 + 竖向连线，「四项能力叠成一个底座」
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 */

const VIEWBOX = 640;
const C = VIEWBOX / 2;

/* ── 01 定位：雷达 ─────────────────────────────────────────────────────── */

const RADAR_OUTER = 264;
const RADAR_RINGS = [72, 136, 200, RADAR_OUTER];
const RADAR_TICKS = 36;
/** 节点：(角度°, 半径) */
const RADAR_NODES: ReadonlyArray<readonly [number, number]> = [
  [-64, 176],
  [-18, 244],
  [34, 118],
  [122, 214],
  [168, 150],
  [236, 246],
];

function polar(angle: number, radius: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [C + Math.cos(rad) * radius, C + Math.sin(rad) * radius];
}

export function RadarPattern() {
  const outer = RADAR_OUTER;
  const [sx, sy] = polar(-90, outer);
  const [ex, ey] = polar(-20, outer);
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="h-auto w-full"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* 扫描扇面 + 外圈刻度：accent 色 */}
      <g className="vx-solutions-pattern-accent">
        <path
          d={`M ${C} ${C} L ${sx} ${sy} A ${outer} ${outer} 0 0 1 ${ex} ${ey} Z`}
          fill="currentColor"
          opacity={0.14}
        />
        <g stroke="currentColor" strokeWidth={1.2}>
          {Array.from({ length: RADAR_TICKS }, (_, i) => {
            const angle = (360 / RADAR_TICKS) * i;
            const long = i % 3 === 0;
            const [x1, y1] = polar(angle, outer + 10);
            const [x2, y2] = polar(angle, outer + (long ? 26 : 18));
            return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
          <circle cx={C} cy={C} r={outer + 36} strokeDasharray="2 12" />
        </g>
      </g>

      {/* 同心圆 + 十字基线 */}
      <g stroke="currentColor" strokeWidth={1.2}>
        {RADAR_RINGS.map((r, i) => (
          <circle
            key={r}
            cx={C}
            cy={C}
            r={r}
            strokeDasharray={i === 1 ? "6 8" : undefined}
          />
        ))}
        <line x1={C - outer} y1={C} x2={C + outer} y2={C} opacity={0.5} />
        <line x1={C} y1={C - outer} x2={C} y2={C + outer} opacity={0.5} />
      </g>

      {/* 汇聚节点与牵引线 */}
      <g stroke="currentColor" strokeWidth={1} opacity={0.7}>
        {RADAR_NODES.map(([angle, radius]) => {
          const [x, y] = polar(angle, radius);
          return <line key={`l-${angle}`} x1={C} y1={C} x2={x} y2={y} />;
        })}
      </g>
      <g fill="currentColor">
        {RADAR_NODES.map(([angle, radius]) => {
          const [x, y] = polar(angle, radius);
          return <circle key={`n-${angle}`} cx={x} cy={y} r={4.5} />;
        })}
        <circle cx={C} cy={C} r={7} />
      </g>
    </svg>
  );
}

/* ── 02 方法：点阵上的阶梯路径 ─────────────────────────────────────────── */

const DOT_STEP = 40;
const DOT_COUNT = VIEWBOX / DOT_STEP;
/** 四个落点：从左下走到右上（点阵格点上） */
const PATH_NODES: ReadonlyArray<readonly [number, number]> = [
  [3, 12],
  [6, 9],
  [10, 6],
  [13, 3],
];

export function PathPattern() {
  const pts: ReadonlyArray<readonly [number, number]> = PATH_NODES.map(
    ([gx, gy]) => [gx * DOT_STEP, gy * DOT_STEP] as const,
  );
  // 阶梯：先横后竖，走格线
  const d = pts
    .map(([x, y], i) => {
      const prevY = pts[i - 1]?.[1] ?? y;
      return i === 0 ? `M ${x} ${y}` : `L ${x} ${prevY} L ${x} ${y}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="h-auto w-full"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* 点阵 */}
      <g fill="currentColor" opacity={0.55}>
        {Array.from({ length: DOT_COUNT + 1 }, (_, i) =>
          Array.from({ length: DOT_COUNT + 1 }, (_, j) => (
            <circle
              key={`${i}-${j}`}
              cx={i * DOT_STEP}
              cy={j * DOT_STEP}
              r={1.4}
            />
          )),
        )}
      </g>

      {/* 路径：accent 色，实线 + 外圈虚线光晕 */}
      <g className="vx-solutions-pattern-accent" stroke="currentColor">
        <path d={d} strokeWidth={10} opacity={0.12} strokeLinejoin="round" />
        <path d={d} strokeWidth={1.8} strokeLinejoin="round" />
      </g>

      {/* 落点：双环节点 */}
      <g stroke="currentColor" strokeWidth={1.2}>
        {pts.map(([x, y]) => (
          <circle key={`ring-${x}-${y}`} cx={x} cy={y} r={14} />
        ))}
      </g>
      <g fill="currentColor">
        {pts.map(([x, y]) => (
          <circle key={`dot-${x}-${y}`} cx={x} cy={y} r={5} />
        ))}
      </g>
    </svg>
  );
}

/* ── 03 能力：四层等轴测叠板 ───────────────────────────────────────────── */

const PLATE_W = 300;
const PLATE_H = 150;
const PLATE_GAP = 74;
const PLATE_COUNT = 4;

function plate(cy: number) {
  const l = C - PLATE_W / 2;
  const r = C + PLATE_W / 2;
  const t = cy - PLATE_H / 2;
  const b = cy + PLATE_H / 2;
  return `M ${C} ${t} L ${r} ${cy} L ${C} ${b} L ${l} ${cy} Z`;
}

export function StackPattern() {
  const firstCy = C - ((PLATE_COUNT - 1) * PLATE_GAP) / 2;
  const centers = Array.from(
    { length: PLATE_COUNT },
    (_, i) => firstCy + i * PLATE_GAP,
  );
  const top = firstCy;
  const bottom = firstCy + (PLATE_COUNT - 1) * PLATE_GAP;
  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="h-auto w-full"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* 四角竖向连线（贯穿四层） */}
      <g stroke="currentColor" strokeWidth={1} opacity={0.6}>
        <line x1={C - PLATE_W / 2} y1={top} x2={C - PLATE_W / 2} y2={bottom} />
        <line x1={C + PLATE_W / 2} y1={top} x2={C + PLATE_W / 2} y2={bottom} />
        <line x1={C} y1={top + PLATE_H / 2} x2={C} y2={bottom + PLATE_H / 2} />
      </g>

      {/* 下三层：主色描边 */}
      <g stroke="currentColor" strokeWidth={1.2}>
        {centers.slice(1).map((cy) => (
          <path key={cy} d={plate(cy)} />
        ))}
      </g>

      {/* 顶层：accent 色，薄填充 + 描边 */}
      <g className="vx-solutions-pattern-accent">
        <path d={plate(top)} fill="currentColor" opacity={0.12} />
        <path d={plate(top)} stroke="currentColor" strokeWidth={1.6} />
      </g>

      {/* 每层一颗节点，落在板面右侧 */}
      <g fill="currentColor">
        {centers.map((cy, i) => (
          <circle key={cy} cx={C + PLATE_W / 4 - i * 12} cy={cy} r={4.5} />
        ))}
      </g>
    </svg>
  );
}
