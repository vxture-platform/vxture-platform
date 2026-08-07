/**
 * SnapDebugPanel.tsx - 滚动吸附调试面板
 *
 * 功能：展示滚动吸附相关的实时调试信息
 * 位置：默认右上角
 *
 * @author Stone Smoker
 * @created 2024-06-01
 * @lastModified 2026-03-03
 * @version 2.0.0
 * @copyright Copyright (c) 2024-2026 Vxture Team
 *
 * @layer Presentation
 * @category Components - Common
 */

import React, { useMemo } from "react";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 位置配置接口
 */
export interface PanelPosition {
  readonly top?: string;
  readonly right?: string;
  readonly bottom?: string;
  readonly left?: string;
  readonly zIndex?: number | string;
}

/**
 * 调试信息接口：定义调试面板显示的数据结构
 */
export interface SnapDebugInfo {
  screenRect?: DOMRect | null;
  targetRect?: DOMRect | null;
  targetsCount?: number;
  activeTargetId?: string | null;
  activeTargetName?: string | null;
  targetAlignTo?: string;
  snapThreshold?: number;
  isScrollingDirection?: "up" | "down" | "no";
  scrollVelocity?: number;
  scrollX?: number;
  scrollY?: number;
}

/**
 * Props 接口
 */
export interface SnapDebugPanelProps {
  readonly visible?: boolean;
  readonly snapdebugInfo?: SnapDebugInfo;
  readonly position?: PanelPosition;
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

// ============================================================================
// 常量定义
// ============================================================================

/** 默认位置 */
const DEFAULT_POSITION = {
  top: "80px",
  right: "20px",
  zIndex: "var(--z-index-toast)",
};
/** 默认可见性 */
const DEFAULT_VISIBLE = true;

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 工具函数：格式化 DOMRect 信息为对象
 */
const formatRect = (
  rect: DOMRect | null | undefined,
): { top: string; left: string; width: string; height: string } | null => {
  if (!rect) return null;
  return {
    top: rect.top.toFixed(2),
    left: rect.left.toFixed(2),
    width: rect.width.toFixed(2),
    height: rect.height.toFixed(2),
  };
};

/**
 * 工具函数：格式化数字，保留两位小数
 */
const formatNumber = (num: number | undefined, defaultValue = 0): string => {
  return num === undefined ? defaultValue.toFixed(2) : num.toFixed(2);
};

// ============================================================================
// 组件实现
// ============================================================================

/**
 * SnapDebugPanel - 滚动吸附调试面板组件
 */
export default function SnapDebugPanel(
  props: SnapDebugPanelProps,
): React.ReactElement | null {
  // ==========================================================================
  // Props 解构
  // ==========================================================================

  const {
    visible = DEFAULT_VISIBLE,
    snapdebugInfo = {},
    position = {},
    className,
    style,
  } = props;

  // ==========================================================================
  // 计算属性
  // ==========================================================================

  /** 合并位置配置 */
  const panelPosition = useMemo(
    () => ({ ...DEFAULT_POSITION, ...position }),
    [position],
  );

  /** 合并最终 style（只放动态样式） */
  const finalStyle = useMemo<React.CSSProperties>(
    () => ({ ...panelPosition, ...style }),
    [panelPosition, style],
  );

  // ==========================================================================
  // 渲染
  // ==========================================================================

  if (!visible) return null;

  return (
    <div
      className={`fixed w-56 max-w-56 overflow-y-auto p-2 bg-vx-black/25 text-vx-white/80 text-xs rounded shadow whitespace-normal ${className || ""}`}
      style={finalStyle}
    >
      <h3 className="mb-1 border-b border-vx-white/20 pb-0.5 font-semibold text-vx-white/70">
        Debug information
      </h3>

      {/* ScreenRect 和 TargetRect 信息 */}
      <div className="space-y-1">
        <div>
          <p className="font-semibold text-vx-white/60">ScreenRect:</p>
          {(() => {
            const rect = formatRect(snapdebugInfo.screenRect);
            if (!rect) return <p className="ml-2 text-vx-white/40">null</p>;
            return (
              <div className="ml-2 space-y-0.5">
                <p>top: {rect.top}</p>
                <p>left: {rect.left}</p>
                <p>width: {rect.width}</p>
                <p>height: {rect.height}</p>
              </div>
            );
          })()}
        </div>

        <div>
          <p className="font-semibold text-vx-white/60">TargetRect:</p>
          {(() => {
            const rect = formatRect(snapdebugInfo.targetRect);
            if (!rect) return <p className="ml-2 text-vx-white/40">null</p>;
            return (
              <div className="ml-2 space-y-0.5">
                <p>top: {rect.top}</p>
                <p>left: {rect.left}</p>
                <p>width: {rect.width}</p>
                <p>height: {rect.height}</p>
              </div>
            );
          })()}
        </div>
      </div>

      {/* 分隔线 */}
      <div className="my-1 h-px bg-vx-white/15"></div>

      {/* 目标和状态信息 */}
      <div className="space-y-1">
        <p>目标总数: {snapdebugInfo.targetsCount ?? 0}</p>
        <p>活跃目标: {snapdebugInfo.activeTargetId ?? "null"}</p>
        <p>目标名称: {snapdebugInfo.activeTargetName ?? "null"}</p>
        <p>对齐方式: {snapdebugInfo.targetAlignTo ?? "top"}</p>
        <p>吸附阈值: {formatNumber(snapdebugInfo.snapThreshold)}px</p>
        <p>滚动方向: {snapdebugInfo.isScrollingDirection ?? "no"}</p>
        <p>滚动速度: {formatNumber(snapdebugInfo.scrollVelocity)}px/帧</p>
      </div>

      {/* 分隔线 */}
      <div className="my-1 h-px bg-vx-white/15"></div>

      {/* 滚动位置信息 */}
      <div className="space-y-1">
        <p>滚动X: {formatNumber(snapdebugInfo.scrollX)}px</p>
        <p>滚动Y: {formatNumber(snapdebugInfo.scrollY)}px</p>
      </div>
    </div>
  );
}
