/**
 * SnapChoicePanel.tsx - 吸附目标选择面板
 *
 * 功能：提供快速跳转到各 section 的按钮列表
 * 位置：默认左上角
 *
 * @author Stone Smoker
 * @created 2024-06-01
 * @lastModified 2026-03-03
 * @version 3.0.0
 * @copyright Copyright (c) 2024-2026 Vxture Team
 *
 * @layer Presentation
 * @category Components - Panels
 */

import React, { useMemo, useCallback, useState, useEffect } from "react";
import { Button } from "@vxture/design-system";

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
 * Section 信息接口
 */
export interface SectionInfo {
  readonly id: string;
  readonly name: string;
}

/**
 * Props 接口
 */
export interface SnapChoicePanelProps {
  readonly sections?: readonly (string | SectionInfo)[];
  readonly targetSelector?: string;
  readonly activeTarget: HTMLElement | null;
  readonly snapToTarget: (target: HTMLElement) => void;
  readonly position?: PanelPosition;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly visible?: boolean;
}

// ============================================================================
// 常量定义
// ============================================================================

/** 默认位置 */
const DEFAULT_POSITION = {
  top: "80px",
  left: "20px",
  zIndex: "var(--z-index-toast)",
};
/** 默认可见性 */
const DEFAULT_VISIBLE = true;
/** 默认目标选择器 */
const DEFAULT_TARGET_SELECTOR = ".snap-section";

// ============================================================================
// 组件实现
// ============================================================================

/**
 * SnapChoicePanel - 吸附选择调试面板组件
 */
export default function SnapChoicePanel(
  props: SnapChoicePanelProps,
): React.ReactElement | null {
  // ==========================================================================
  // Props 解构
  // ==========================================================================

  const {
    sections,
    targetSelector = DEFAULT_TARGET_SELECTOR,
    activeTarget,
    snapToTarget,
    position = {},
    className,
    style,
    visible = DEFAULT_VISIBLE,
  } = props;

  // ==========================================================================
  // 状态初始化
  // ==========================================================================

  /** 自动发现的 section 列表 */
  const [discoveredSections, setDiscoveredSections] = useState<SectionInfo[]>(
    [],
  );

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

  /** 标准化 sections 为 SectionInfo 数组 */
  const normalizedSections = useMemo((): SectionInfo[] => {
    // 优先级1：传入的 sections
    if (sections && sections.length > 0) {
      return sections.map((s) =>
        typeof s === "string" ? { id: s, name: s } : s,
      );
    }
    // 优先级2：自动发现的 sections
    return discoveredSections;
  }, [sections, discoveredSections]);

  // ==========================================================================
  // Effects
  // ==========================================================================

  /** 自动发现页面上的 section 元素 */
  useEffect(() => {
    // 如果传入了 sections，就不自动发现
    if (sections && sections.length > 0) {
      return;
    }

    const discoverSections = () => {
      const sectionElements = document.querySelectorAll(targetSelector);
      const found: SectionInfo[] = [];
      sectionElements.forEach((section) => {
        if (section.id) {
          found.push({ id: section.id, name: section.id });
        }
      });
      if (found.length > 0) {
        setDiscoveredSections(found);
      }
    };

    // 初始发现
    discoverSections();

    // 使用 MutationObserver 监听 DOM 变化
    const observer = new MutationObserver(() => {
      discoverSections();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["id"],
    });

    return () => observer.disconnect();
  }, [sections, targetSelector]);

  // ==========================================================================
  // 事件处理
  // ==========================================================================

  /**
   * 处理按钮点击
   */
  const handleButtonClick = useCallback(
    (targetId: string) => {
      const target = document.getElementById(targetId);
      if (target) {
        snapToTarget(target);
      }
    },
    [snapToTarget],
  );

  // ==========================================================================
  // 渲染
  // ==========================================================================

  if (!visible) return null;

  return (
    <div
      className={`fixed flex flex-col gap-1 w-auto bg-vx-black/25 text-vx-white/80 p-2 rounded shadow text-xs ${className || ""}`}
      style={finalStyle}
    >
      <h3 className="font-semibold mb-1 text-vx-white/70">Sections Choice</h3>

      {normalizedSections.map(({ id, name }) => {
        const isActive = activeTarget?.id === id;

        return (
          <Button
            key={id}
            variant={isActive ? "default" : "secondary"}
            size="md"
            onClick={() => handleButtonClick(id)}
            className={`min-w-20 px-2 py-2 rounded transition text-left ${
              isActive
                ? "bg-vx-primary/60 text-vx-white"
                : "bg-vx-white/20 text-vx-white/70 hover:bg-vx-white/30"
            }`}
          >
            {id} - {name}
          </Button>
        );
      })}
    </div>
  );
}
