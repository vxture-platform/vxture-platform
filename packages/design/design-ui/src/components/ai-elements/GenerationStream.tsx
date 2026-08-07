"use client";

/**
 * GenerationStream.tsx - AI 流式生成展示面
 * @package @vxture/design-ui
 * @layer Presentation
 * @category Components - AI
 * @description
 *   呈现生成中状态、流式文本和 token 吞吐元信息。
 *
 * ai 语气只在生成态出现：完成之后这块就是普通正文，继续亮着会让人以为还在跑。
 *
 * 文本用 `whitespace-pre-wrap`：模型输出里的换行和缩进是内容的一部分，
 * 折叠掉等于把代码块和列表压成一行。
 *
 * @author AI-Generated
 * @date 2026-05-16
 */

import { cn } from "../../utils/cn";

export interface GenerationStreamProps {
  readonly text: string;
  readonly streaming?: boolean;
  readonly modelId?: string;
  readonly tokensProduced?: number;
  readonly tokensPerSecond?: number;
  readonly label?: string;
  readonly className?: string;
}

export function GenerationStream({
  text,
  streaming = true,
  modelId,
  tokensProduced,
  tokensPerSecond,
  label,
  className,
}: GenerationStreamProps) {
  const hasMeta =
    modelId || tokensProduced !== undefined || tokensPerSecond !== undefined;

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-sm rounded-xl border p-md",
        streaming
          ? "border-ai-border bg-ai-muted"
          : "border-border bg-surface-1",
        className,
      )}
    >
      <div className="flex items-center gap-xs">
        {streaming ? (
          <span
            className="size-2xs shrink-0 animate-pulse rounded-full bg-ai"
            aria-hidden
          />
        ) : null}
        <span
          className={cn(
            "text-overline",
            streaming ? "text-ai-text" : "text-muted-foreground",
          )}
        >
          {label ?? (streaming ? "GENERATING" : "COMPLETE")}
        </span>
      </div>

      <div className="text-body-md whitespace-pre-wrap text-foreground">
        {text}
        {streaming ? (
          <span
            className="ml-2xs inline-block h-icon-xs w-2xs animate-pulse rounded-sm bg-ai align-text-bottom"
            aria-hidden
          />
        ) : null}
      </div>

      {hasMeta ? (
        <div className="flex flex-wrap items-center gap-md font-mono text-body-sm text-muted-foreground">
          {tokensProduced !== undefined ? (
            <span>tokens: {tokensProduced.toLocaleString()}</span>
          ) : null}
          {tokensPerSecond !== undefined ? (
            <span>{tokensPerSecond} tok/s</span>
          ) : null}
          {modelId ? <span>{modelId}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
