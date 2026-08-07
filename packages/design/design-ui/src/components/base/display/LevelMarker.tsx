/**
 * LevelMarker.tsx - 等级记号：L1–L5 的圆形底座。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Display
 *
 * 它是**底座**，不管里面放什么：数字、图标、徽章图都由调用方给（owner 2026-08-06）。
 * 等级到内容的映射是业务判断——"第几名配哪张徽章"、"哪一档套餐叫什么"，DS 不知道。
 *
 * 全站唯一刻意不扁平的件：渐变 + 外发光 + 内高光。等级本就是要被一眼挑出来的记号，
 * 与周围扁平的状态标、指标读数拉开层次；反过来说，除了它以外的地方不该出现这套材质。
 *
 * 语气不进这件：等级色是单色相的五档明度（见 color-policy 的 LEVEL_RAMP），
 * 与六个意图族正交——一个"五级"不是一种成功或警告。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";

export type Level = 1 | 2 | 3 | 4 | 5;

/* 变量名逐条写出而非按 level 拼接：拼出来的 var 名 grep 不到，改 token 时找不着用处。 */
const LEVEL_VARS: Record<Level, { fill: string; deep: string; fg: string }> = {
  1: { fill: "--level-1", deep: "--level-1-deep", fg: "--level-1-foreground" },
  2: { fill: "--level-2", deep: "--level-2-deep", fg: "--level-2-foreground" },
  3: { fill: "--level-3", deep: "--level-3-deep", fg: "--level-3-foreground" },
  4: { fill: "--level-4", deep: "--level-4-deep", fg: "--level-4-foreground" },
  5: { fill: "--level-5", deep: "--level-5-deep", fg: "--level-5-foreground" },
};

const BY_SIZE = {
  sm: "size-control-2xs text-label-sm",
  md: "size-control-sm text-label-md",
} as const;

export interface LevelMarkerProps {
  readonly level: Level;
  /** 记号里的内容：名次数字、图标、徽章图。 */
  readonly children?: React.ReactNode;
  readonly size?: keyof typeof BY_SIZE;
  /** 读屏器读到的说法（"第 1 名"、"企业版"）——数字本身说明不了它是什么。 */
  readonly "aria-label"?: string;
  readonly className?: string;
}

function LevelMarker({
  level,
  children,
  size = "md",
  "aria-label": ariaLabel,
  className,
}: LevelMarkerProps) {
  const vars = LEVEL_VARS[level];

  return (
    <span
      {...(ariaLabel !== undefined
        ? { role: "img", "aria-label": ariaLabel }
        : { "aria-hidden": true })}
      style={{
        // 起点带一点透明、终点实心：立体感来自渐变与透明度，不靠把色阶取深
        // （owner 2026-08-06：色阶淡一些、差距不用太大）。
        background: `linear-gradient(160deg, color-mix(in srgb, var(${vars.fill}) 82%, transparent), var(${vars.deep}))`,
        color: `var(${vars.fg})`,
        boxShadow: [
          // 发光复用 brand 的 glow 两档——等级族本就是同色相，无需另开 token。
          "0 0 0 1px var(--gradient-glow-to)",
          "0 1px 4px -1px var(--gradient-glow-from)",
          // 内高光：上缘一道白，让圆面看起来是凸的而非贴纸。
          "inset 0 1px 0 0 color-mix(in srgb, var(--vx-color-white) 38%, transparent)",
        ].join(", "),
      }}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-bold tabular-nums",
        BY_SIZE[size],
        className,
      )}
    >
      {children}
    </span>
  );
}

export { LevelMarker };
