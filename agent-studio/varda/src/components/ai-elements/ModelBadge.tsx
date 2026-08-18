"use client";

/**
 * ModelBadge.tsx - AI 模型身份徽章
 * @package @vxture/agent-studio-varda
 * @layer Presentation
 * @category Components - AI
 * @description
 *   用于模型选择、部署状态和 AI Header，不作为通用 Badge 的替代。
 *
 * 部署状态映射到语气刻度而非自造一套色：`deploying` 是进行中不是异常，落 info；
 * `idle` 不是故障，落中性。DS 内同一语气在各处必须是同一个颜色。
 *
 * @author AI-Generated
 * @date 2026-05-16
 */

import type { KeyboardEvent } from "react";
import { cn, type Tone } from "@vxture/design-system";

// DS 配方层（styles/recipes）不出公共 API；`interactive` 的等价类名就地展开，
// 取值来源 design-ui/src/styles/recipes.ts——DS 基调变更时此处需跟随。
const interactive = [
  "outline-none",
  "transition-all duration-fast ease-standard",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "disabled:pointer-events-none disabled:opacity-disabled",
].join(" ");

export type ModelBadgeStatus = "active" | "idle" | "deploying" | "error";

export interface ModelBadgeProps {
  readonly modelId: string;
  readonly variant?: "default" | "flagship";
  readonly status?: ModelBadgeStatus;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

const STATUS_LABEL: Record<ModelBadgeStatus, string> = {
  active: "ACTIVE",
  idle: "IDLE",
  deploying: "DEPLOYING",
  error: "ERROR",
};

const STATUS_TONE: Record<ModelBadgeStatus, Tone> = {
  active: "success",
  idle: "neutral",
  deploying: "info",
  error: "danger",
};

/** 只染圆点与状态字，不染整块——徽章成排出现时，四种满色底会糊成一片。 */
const TONE_DOT: Record<Tone, string> = {
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

export function ModelBadge({
  modelId,
  variant = "default",
  status = "active",
  onClick,
  disabled = false,
  className,
}: ModelBadgeProps) {
  const isInteractive = !!onClick && !disabled;
  const tone = STATUS_TONE[status];

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!isInteractive) return;
    if (event.key === " ") {
      event.preventDefault(); // prevent page scroll on Space
    } else if (event.key === "Enter") {
      event.preventDefault();
      onClick!();
    }
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!isInteractive || event.key !== " ") return;
    onClick!();
  };

  return (
    <span
      className={cn(
        "inline-flex h-control-2xs w-fit shrink-0 items-center gap-xs",
        "rounded-4xl border border-border px-sm text-label-sm whitespace-nowrap",
        // 旗舰款用 ai 语气托底：它说的是"这台是主力"，属身份不属状态，
        // 所以染底；状态只染圆点和那三个字母。
        variant === "flagship"
          ? "border-ai-border bg-ai-muted"
          : "bg-transparent",
        interactive,
        isInteractive && "cursor-pointer hover:bg-accent",
        disabled && "pointer-events-none opacity-disabled",
        className,
      )}
      onClick={isInteractive ? onClick : undefined}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      role={onClick ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      aria-disabled={disabled || undefined}
    >
      <span
        className={cn("size-2xs shrink-0 rounded-full", TONE_DOT[tone])}
        aria-hidden
      />
      <span className="truncate text-foreground">{modelId}</span>
      <span className={cn("font-mono", TONE_TEXT[tone])}>
        {STATUS_LABEL[status]}
      </span>
    </span>
  );
}
