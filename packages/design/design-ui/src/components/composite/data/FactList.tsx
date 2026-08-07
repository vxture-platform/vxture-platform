/**
 * FactList.tsx - 右对齐的若干「键 值」。
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - Pattern
 *
 * 与 `MetricCardProps.tags` 的分工：tags 与读数同行、彼此并列、无层级；本件是两级
 * 的键值对，且各行可独立带语气（"逾期 3" 要能自己变红）。塞进 tags 会把键值压成一
 * 串文字（2026-08-06，admin 经营指标 9 处）。
 */

import * as React from "react";
import { cn } from "../../../utils/cn";
import type { StatusBadgeTone } from "../../base/display/StatusBadge";

export interface Fact {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  readonly tone?: StatusBadgeTone;
}

const FACT_TONE: Record<StatusBadgeTone, string> = {
  neutral: "",
  brand: "text-primary-text",
  info: "text-info-text",
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-destructive-text",
};

export interface FactListProps {
  readonly facts: readonly Fact[];
  readonly className?: string;
}

function FactList({ facts, className }: FactListProps) {
  return (
    <dl className={cn("flex flex-col gap-2xs whitespace-nowrap", className)}>
      {facts.map((fact, index) => {
        const tone = fact.tone ?? "neutral";
        return (
          <div
            key={index}
            className={cn("flex items-center gap-xs", FACT_TONE[tone])}
          >
            {/* 带语气时键与值同色：语气标的是这条事实整体，只染值会读成两件事。 */}
            <dt
              className={cn(
                "text-body-sm",
                tone === "neutral" && "text-muted-foreground",
              )}
            >
              {fact.label}
            </dt>
            <dd className="text-body-sm">{fact.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export { FactList };
