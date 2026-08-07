/**
 * VardaChat.tsx - Varda 主入口组件（sidebar / float / inline 三种布局）
 * @package @vxture/agent-studio-varda
 * @layer Presentation
 * @category Component
 *
 * @author AI-Generated
 * @date 2026-04-30
 */

"use client";

import { Button } from "@vxture/design-system";
import { useVardaStore } from "../stores/varda.store";
import { useVardaSurface } from "../hooks/useVardaSurface";
import { MessageList } from "./MessageList";
import { InputBar } from "./InputBar";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import type { VardaSurface } from "../types/varda.types";

// ============================================================================
// Props
// ============================================================================

/** 内联面板档位：窄 / 宽 / 全屏。仅 `position="inline"` 使用。 */
export type VardaInlineMode = "narrow" | "wide" | "full";

export interface VardaChatProps {
  surface: VardaSurface;
  /**
   * sidebar：固定侧边栏；float：右下角浮动窗口；
   * inline：嵌入式面板（由宿主放入布局栅格，开合/档位由宿主控制）。
   */
  position: "sidebar" | "float" | "inline";
  /** inline 专用：面板档位（默认 narrow）。 */
  mode?: VardaInlineMode;
  /** inline 专用：关闭面板（由宿主控制布局收起）。 */
  onClose?: () => void;
  /** inline 专用：在 窄/宽 之间切换。 */
  onToggleWide?: () => void;
  /** inline 专用：进入/退出全屏。 */
  onToggleFull?: () => void;
}

// ============================================================================
// 组件
// ============================================================================

export function VardaChat({
  surface,
  position,
  mode = "narrow",
  onClose,
  onToggleWide,
  onToggleFull,
}: VardaChatProps) {
  useVardaSurface(surface);

  const isOpen = useVardaStore((s) => s.isOpen);
  const toggleOpen = useVardaStore((s) => s.toggleOpen);

  // ---- inline 模式：嵌入式面板，可见性与档位由宿主控制（宿主未挂载即不渲染）
  if (position === "inline") {
    return (
      <div
        className={`vx-varda-chat vx-varda-chat--inline vx-varda-chat--${mode}`}
      >
        <Header
          surface={surface}
          mode={mode}
          onClose={onClose}
          onToggleWide={onToggleWide}
          onToggleFull={onToggleFull}
        />
        <MessageList />
        <ConfirmActionDialog />
        <InputBar />
      </div>
    );
  }

  // ---- sidebar 模式：始终可见
  if (position === "sidebar") {
    return (
      <div className="vx-varda-chat vx-varda-chat--sidebar">
        <Header surface={surface} />
        <MessageList />
        <ConfirmActionDialog />
        <InputBar />
      </div>
    );
  }

  // ---- float 模式：按钮展开/收起
  return (
    <>
      {isOpen && (
        <div className="vx-varda-chat vx-varda-chat--float">
          <Header surface={surface} onClose={toggleOpen} />
          <MessageList />
          <ConfirmActionDialog />
          <InputBar />
        </div>
      )}
      <Button
        className="vx-varda-float-button"
        onClick={toggleOpen}
        aria-label="打开 Varda 助手"
        size="icon-md"
      >
        {isOpen ? "✕" : "✦"}
      </Button>
    </>
  );
}

// ============================================================================
// 内部 Header
// ============================================================================

interface HeaderProps {
  surface: VardaSurface;
  onClose?: (() => void) | undefined;
  /** inline 档位；提供时渲染加宽/全屏控制。 */
  mode?: VardaInlineMode | undefined;
  onToggleWide?: (() => void) | undefined;
  onToggleFull?: (() => void) | undefined;
}

function Header({ onClose, mode, onToggleWide, onToggleFull }: HeaderProps) {
  const hasControls = Boolean(onToggleWide || onToggleFull || onClose);

  return (
    <div className="vx-varda-header">
      <div className="vx-varda-header__leading">
        <span className="vx-varda-header__title">Varda</span>
        <span className="vx-varda-header__brandtag">瓦尔妲</span>
      </div>
      {hasControls && (
        <div className="vx-varda-header__actions">
          {onToggleWide && mode !== "full" && (
            <Button
              onClick={onToggleWide}
              className="vx-varda-header__action"
              aria-label={mode === "wide" ? "还原窄版" : "加宽"}
              title={mode === "wide" ? "还原窄版" : "加宽"}
              variant="ghost"
              size="icon-md"
            >
              {/* 设计图标（Phosphor，由宿主 console 全局加载）。 */}
              <i
                className={
                  "ph " +
                  (mode === "wide"
                    ? "ph-arrow-line-right"
                    : "ph-arrow-line-left")
                }
              />
            </Button>
          )}
          {onToggleFull && (
            <Button
              onClick={onToggleFull}
              className="vx-varda-header__action"
              aria-label={mode === "full" ? "退出全屏" : "全屏"}
              title={mode === "full" ? "退出全屏" : "全屏"}
              variant="ghost"
              size="icon-md"
            >
              <i
                className={
                  "ph " + (mode === "full" ? "ph-corners-in" : "ph-corners-out")
                }
              />
            </Button>
          )}
          {onClose && (
            <Button
              onClick={onClose}
              className="vx-varda-header__close"
              aria-label="关闭"
              variant="ghost"
              size="icon-md"
            >
              {/* inline（console，已加载 Phosphor）用设计图标；float 兜底字形。 */}
              {mode ? <i className="ph ph-x" /> : "✕"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
