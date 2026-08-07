"use client";

/**
 * PromptInput.tsx - AI Prompt 输入框
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - AI
 * @description
 *   提供 AI 专用输入、mention chip、工具栏和快捷提交能力。
 *
 * 输入区与提交键复用 `Textarea` / `Button`，不自己再实现一遍：焦点环、禁用态、
 * 移动端 16px 防缩放这些都在那两件里，重写一份必然漏掉其中几条。
 *
 * chip 用 `Button` 的 xs 档而不是 Badge：它们可点、可切换，是控件不是标签。
 *
 * @author AI-Generated
 * @date 2026-05-16
 */

import type { KeyboardEvent } from "react";
import { cn } from "../../utils/cn";
import { Button } from "../base/form/Button";
import { Textarea } from "../base/form/Textarea";

export interface PromptInputChip {
  readonly label: string;
  readonly active?: boolean;
  readonly onClick?: () => void;
}

export interface PromptInputProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly placeholder?: string;
  readonly label?: string;
  readonly chips?: readonly PromptInputChip[];
  readonly hint?: string;
  readonly submitLabel?: string;
  readonly busy?: boolean;
  readonly className?: string;
}

export function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Ask anything...",
  label,
  chips,
  hint = "Cmd+Enter to send",
  submitLabel = "Generate",
  busy = false,
  className,
}: PromptInputProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    if (!busy) {
      onSubmit?.(value);
    }
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-sm rounded-xl border border-border bg-card p-md",
        // 生成中整块压暗并锁交互：此时再改 prompt 也不会影响已经在跑的那次。
        busy && "pointer-events-none opacity-muted",
        className,
      )}
    >
      {chips && chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-xs">
          {chips.map((chip) => (
            <Button
              key={chip.label}
              type="button"
              size="xs"
              variant={chip.active ? "secondary" : "ghost"}
              aria-pressed={chip.active ?? false}
              onClick={chip.onClick}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      ) : null}

      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        rows={3}
        className="border-none bg-transparent shadow-none dark:bg-transparent"
      />

      <div className="flex flex-wrap items-center justify-between gap-sm">
        <span className="text-body-sm text-muted-foreground">{hint}</span>
        <Button
          type="button"
          disabled={busy || !value.trim()}
          onClick={() => onSubmit?.(value)}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
