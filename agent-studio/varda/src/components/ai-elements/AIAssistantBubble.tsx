"use client";

/**
 * AIAssistantBubble.tsx - AI 对话气泡
 * @package @vxture/agent-studio-varda
 * @layer Presentation
 * @category Components - AI
 * @description
 *   提供 user / ai 对称布局和可替换头像，用于 AI 助手对话流。
 *
 * 头像复用 `Avatar`，不自己写一个圆形容器——对话流里的头像和后台列表里的头像
 * 应当是同一个尺寸刻度和同一套回退规则。
 *
 * 两侧气泡用不同语气而非左右镜像的同一种色：谁在说话是靠颜色区分的，
 * 单靠位置在窄屏折行后就分不出来了。
 *
 * @author AI-Generated
 * @date 2026-05-16
 */

import type { ReactNode } from "react";
import { cn } from "@vxture/design-system";
import { Avatar, AvatarFallback, AvatarImage } from "@vxture/design-system";

export interface AIAssistantBubbleProps {
  readonly role: "user" | "ai";
  readonly children: ReactNode;
  readonly avatar?: string;
  readonly avatarSrc?: string;
  readonly timestamp?: string | Date;
  readonly className?: string;
}

export function AIAssistantBubble({
  role,
  children,
  avatar,
  avatarSrc,
  timestamp,
  className,
}: AIAssistantBubbleProps) {
  const isAI = role === "ai";
  const fallbackAvatar = avatar ?? (isAI ? "AI" : "U");
  const time =
    timestamp instanceof Date
      ? timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : timestamp;

  return (
    <div
      className={cn(
        "flex w-full items-start gap-sm",
        // 用户侧整体靠右并把头像换到末位，读起来才是"我说的在右边"。
        isAI ? "flex-row" : "flex-row-reverse",
        className,
      )}
    >
      <Avatar className="shrink-0">
        {avatarSrc ? <AvatarImage src={avatarSrc} alt="" /> : null}
        <AvatarFallback>{fallbackAvatar}</AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2xs",
          isAI ? "items-start" : "items-end",
        )}
      >
        <div
          className={cn(
            "max-w-content-narrow-lg rounded-xl px-md py-sm text-body-md",
            isAI
              ? "bg-ai-muted text-ai-muted-foreground"
              : "bg-primary-muted text-primary-muted-foreground",
          )}
        >
          {children}
        </div>
        {time ? (
          <span className="text-body-sm text-muted-foreground">{time}</span>
        ) : null}
      </div>
    </div>
  );
}
