/**
 * BarChart.tsx - 柱状图。
 * @package @vxture/design-ui
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Pattern
 *
 * DS 的第一件数据可视化原语（2026-08-21 owner 定：用量分析各板块"上图下表"，
 * 图为全宽柱状图——按 30 天逐日展开、或按 24 小时展开一天）。只做一件事：
 * 一组 `{label, value}` 按等宽柱子铺满容器宽度，高度按组内最大值归一。
 *
 * 取值全走 T2 语义类：柱体 `bg-primary`（与 Progress 填充同色——同一"量的
 * 表达"在 DS 内不能有两套颜色）、零值柱留 `bg-accent` 基线刻度（有数据的
 * 天与没数据的天要能分开）、基线用 hairline.block（与 DataTable 顶边同规）。
 * 柱高是运行时数据不是设计刻度，只能走内联 style（承自 Progress 的先例）。
 *
 * 横轴标签抽样显示（`labelEvery`，缺省按数据量自动取 ~6 个），未抽中的槽位
 * 以 `invisible` 占位保持网格对齐——标签是刻度不是数据，挤成一排反而不可读。
 * 逐柱数值不上图（悬停以原生 title 报数）；精确数字归下方配套的表。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import { hairline } from "../../../styles/recipes";

export interface BarChartDatum {
  /** 行键（React key）。 */
  readonly key: string;
  /** 横轴刻度文本（抽样显示）。 */
  readonly label: string;
  readonly value: number;
}

export interface BarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly data: readonly BarChartDatum[];
  /** 悬停 title 与横轴无关的数值格式化（缺省 toLocaleString）。 */
  readonly formatValue?: (value: number) => string;
  /**
   * 每隔几根柱子显示一个横轴标签。缺省自动：≤12 根全显，否则取 ~6 个刻度。
   */
  readonly labelEvery?: number;
}

const BarChart = React.forwardRef<HTMLDivElement, BarChartProps>(
  function BarChart(
    { className, data, formatValue, labelEvery, ...props },
    ref,
  ) {
    const fmt = formatValue ?? ((v: number) => v.toLocaleString("en-US"));
    const max = data.reduce((m, d) => Math.max(m, d.value), 0);
    const every =
      labelEvery ?? (data.length <= 12 ? 1 : Math.ceil(data.length / 6));

    return (
      <div
        ref={ref}
        role="img"
        className={cn("flex w-full flex-col gap-xs", className)}
        {...props}
      >
        <div
          className={cn(
            "flex h-media-lg w-full items-end gap-xs border-b",
            hairline.block,
          )}
        >
          {data.map((d) => (
            <div
              key={d.key}
              title={`${d.label}: ${fmt(d.value)}`}
              className="flex h-full flex-1 flex-col justify-end"
            >
              {d.value > 0 && max > 0 ? (
                <div
                  className="w-full rounded-t-sm bg-primary transition-all duration-base ease-standard"
                  // 柱高是运行时数据，只能走内联 style（Progress 同款先例）。
                  style={{
                    height: `${Math.max(2, (d.value / max) * 100)}%`,
                  }}
                />
              ) : (
                <div className="h-px w-full bg-accent" />
              )}
            </div>
          ))}
        </div>
        <div className="flex w-full gap-xs">
          {data.map((d, i) => (
            <span
              key={d.key}
              className={cn(
                "flex-1 overflow-hidden text-center whitespace-nowrap text-body-sm text-muted-foreground tabular-nums",
                i % every !== 0 && "invisible",
              )}
            >
              {d.label}
            </span>
          ))}
        </div>
      </div>
    );
  },
);

BarChart.displayName = "BarChart";

export { BarChart };
