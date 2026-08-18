"use client";

/* Varda 停靠列：外壳走 DS ShellDock（批 D 自 shell-template 的 .assistant
 * 收编，narrow/wide/full 三档同值），内部渲染真实 VardaChat（inline 模式，
 * 自带 header/消息/输入与档位控制）。 */

import dynamic from "next/dynamic";
import { ShellDock } from "@vxture/design-system";
import type { VardaInlineMode } from "@vxture/agent-studio-varda";

const VardaChat = dynamic(
  () => import("@vxture/agent-studio-varda").then((m) => m.VardaChat),
  { ssr: false },
);

export interface TemplateAssistantProps {
  mode: VardaInlineMode;
  onClose: () => void;
  onToggleWide: () => void;
  onToggleFull: () => void;
}

export function TemplateAssistant({
  mode,
  onClose,
  onToggleWide,
  onToggleFull,
}: TemplateAssistantProps) {
  return (
    <ShellDock mode={mode}>
      <VardaChat
        surface="console"
        position="inline"
        mode={mode}
        onClose={onClose}
        onToggleWide={onToggleWide}
        onToggleFull={onToggleFull}
      />
    </ShellDock>
  );
}
