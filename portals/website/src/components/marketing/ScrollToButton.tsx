/**
 * ScrollToButton.tsx - 滚动到目标按钮组件
 *
 * 功能：提供滚动到指定目标的按钮功能，支持回到顶部、滚动到指定元素等
 *
 * @author Stone Smoker
 * @created 2024-06-01
 * @lastModified 2026-03-03
 * @version 3.0.0
 * @copyright Copyright (c) 2024-2026 Vxture Team
 *
 * @layer Presentation
 * @category Components - Widgets
 */
"use client";

import { useCallback } from "react";
import { Button, Icon } from "@vxture/design-system";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * Props 接口
 */
interface ScrollToButtonProps {
  readonly text?: string;
  readonly positionClass?: string;
  readonly className?: string;
  readonly animationClass?: string;
  readonly iconSize?: string;
  readonly ariaLabel?: string;
  readonly snapToTarget?: (target: HTMLElement) => void;
  readonly targetSelector?: string;
  readonly targetElement?: HTMLElement;
}

// ============================================================================
// 常量定义
// ============================================================================

/** 默认文本 */
const DEFAULT_TEXT = "Top";
/** 默认位置 */
const DEFAULT_POSITION_CLASS = "absolute right-16 bottom-20";
/** 默认动画：无（owner 2026-08-18 判）。原默认 `animate-bounce` 是 Tailwind 的
 * **无限循环**弹跳（1s 一跳、位移 25%），按钮在页面上永远疯狂跳动——装饰动画
 * 不该常驻，交互反馈已有 hover 位移与阴影。要引导注意力由调用方显式传入。 */
const DEFAULT_ANIMATION_CLASS = "";
/** 默认图标尺寸 */
const DEFAULT_ICON_SIZE = "w-5 h-5";
/** 默认目标选择器 */
const DEFAULT_TARGET_SELECTOR = ".snap-section";

// ============================================================================
// 组件实现
// ============================================================================

/**
 * ScrollToButton - 滚动到目标按钮组件
 */
export default function ScrollToButton({
  text = DEFAULT_TEXT,
  positionClass = DEFAULT_POSITION_CLASS,
  className = "",
  animationClass = DEFAULT_ANIMATION_CLASS,
  iconSize = DEFAULT_ICON_SIZE,
  ariaLabel,
  snapToTarget,
  targetSelector,
  targetElement,
}: ScrollToButtonProps) {
  // ==========================================================================
  // 安全检查
  // ==========================================================================

  /** 安全判断：是否有 window 对象 */
  const hasWindow = globalThis?.window !== undefined;

  // ==========================================================================
  // 样式定义
  // ==========================================================================

  /** 基础样式（默认状态） */
  const baseButtonClass = `
    flex items-center justify-center
    w-12 h-12 rounded-full
    bg-gradient-to-br from-vx-gray-100 to-vx-brand-100
    text-vx-gray-500
    shadow-sm
    backdrop-blur-sm
    transition-all duration-300
  `;

  /** 基础样式（交互样式)  */
  const interactiveClass = `
    hover:from-vx-brand-100 hover:to-vx-brand-200
    hover:text-vx-brand-500
    hover:shadow-md
    hover:-translate-y-0.5
    active:translate-y-0
    active:shadow-sm
    focus:outline-none
    focus-visible:ring-2
    focus-visible:ring-vx-brand-100
    focus-visible:ring-offset-2
  `;

  // ==========================================================================
  // 辅助函数
  // ==========================================================================

  /**
   * 获取目标元素
   */
  const getTargetElement = useCallback((): HTMLElement | null => {
    // 优先级1：直接指定的元素
    if (targetElement) {
      return targetElement;
    }
    // 优先级2：自定义选择器
    const selector = targetSelector || DEFAULT_TARGET_SELECTOR;
    return document.querySelector(selector);
  }, [targetElement, targetSelector]);

  // ==========================================================================
  // 事件处理
  // ==========================================================================

  /**
   * 处理按钮点击
   */
  const handleClick = useCallback(() => {
    const target = getTargetElement();

    if (snapToTarget && target) {
      snapToTarget(target);
    } else if (hasWindow) {
      if (target) {
        // 有目标元素：滚动到该元素
        const rect = target.getBoundingClientRect();
        const win = globalThis.window as Window;
        const scrollTop = rect.top + win.scrollY;
        win.scrollTo({
          top: scrollTop,
          behavior: "smooth",
        });
      } else {
        // 无目标元素：滚动到顶部
        (globalThis.window as Window).scrollTo({
          top: 0,
          behavior: "smooth",
        });
      }
    }
  }, [snapToTarget, hasWindow, getTargetElement]);

  // ==========================================================================
  // 渲染
  // ==========================================================================

  return (
    <div className={`${positionClass} z-40`}>
      <Button
        variant="ghost"
        size="icon-md"
        onClick={handleClick}
        aria-label={ariaLabel || text}
        className={`
          ${baseButtonClass}
          ${interactiveClass}
          ${animationClass}
          ${className}
        `}
      >
        <Icon name="chevron-up" className={iconSize} />
      </Button>
    </div>
  );
}
