"use client";

/**
 * TokenCounter.tsx - AI token 用量条
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - AI
 * @description
 *   按消耗比例分三段语气：60% 以下正常，60–85% 提醒，85% 以上告警。
 *
 * 原实现的中段叫 `spark`，那是个只在这一件里存在的语气名。改用 `warning`——
 * 同一严重度在 DS 内必须只有一个名字，否则 StatusBadge 与它对同一件事会给出
 * 两种颜色。阈值本身没动。
 *
 * @author AI-Generated
 * @date 2026-05-16
 */

import { cn } from "../../utils/cn";
import type { Tone } from "../tone";

export interface TokenCounterProps {
  readonly used: number;
  readonly total: number;
  readonly label?: string;
  readonly showNumbers?: boolean;
  readonly className?: string;
}

const TONE_FILL: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  brand: "bg-primary",
  info: "bg-info-border",
  success: "bg-success-border",
  warning: "bg-warning-border",
  danger: "bg-destructive-border",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  brand: "text-primary-text",
  info: "text-info-text",
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-destructive-text",
};

export function TokenCounter({
  used,
  total,
  label = "USAGE",
  showNumbers = true,
  className,
}: TokenCounterProps) {
  const safeTotal = Math.max(total, 1);
  const percent = Math.min(100, Math.max(0, (used / safeTotal) * 100));
  const tone: Tone =
    percent >= 85 ? "danger" : percent >= 60 ? "warning" : "success";

  return (
    <div className={cn("flex w-full flex-col gap-2xs", className)}>
      <div className="flex items-baseline justify-between gap-sm">
        <span className="text-overline text-muted-foreground">{label}</span>
        {showNumbers ? (
          <span className="font-mono text-body-md">
            <span className={TONE_TEXT[tone]}>{used.toLocaleString()}</span>
            <span className="text-muted-foreground">
              {" / "}
              {safeTotal.toLocaleString()} tokens
            </span>
          </span>
        ) : (
          <span className={cn("font-mono text-body-md", TONE_TEXT[tone])}>
            {percent.toFixed(0)}%
          </span>
        )}
      </div>
      <div
        className="h-2xs w-full overflow-hidden rounded-4xl bg-accent"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={safeTotal}
      >
        {/* 宽度是运行时值，只能走内联 style——它不是设计刻度，是数据。 */}
        <div
          className={cn(
            "h-full rounded-4xl transition-all duration-base ease-standard",
            TONE_FILL[tone],
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
