/**
 * useBreakpoint.ts - 断点 Hook
 * @package @vxture/design-ui
 *
 * 功能：响应式断点检测 Hook，与 TailwindCSS 4 断点保持一致
 *
 * @copyright Vxture Team
 * @layer Application
 * @category Hooks
 */

import * as React from "react";

/**
 * 断点名称类型
 *
 * - base: < 640px
 * - sm: >= 640px
 * - md: >= 768px
 * - lg: >= 1024px
 * - xl: >= 1280px
 * - 2xl: >= 1536px
 */
export type Breakpoint = "base" | "sm" | "md" | "lg" | "xl" | "2xl";

/**
 * 断点配置（与 TailwindCSS 4 默认断点一致）
 */
const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

/**
 * 根据宽度获取当前断点
 *
 * @param width - 窗口宽度（像素）
 * @returns 断点名称
 */
function getBreakpoint(width: number): Breakpoint {
  if (width >= breakpoints["2xl"]) return "2xl";
  if (width >= breakpoints.xl) return "xl";
  if (width >= breakpoints.lg) return "lg";
  if (width >= breakpoints.md) return "md";
  if (width >= breakpoints.sm) return "sm";
  return "base";
}

/**
 * useBreakpoint 返回值接口
 */
export interface UseBreakpointReturn {
  /** 当前激活的断点名称 */
  breakpoint: Breakpoint;
  /** 是否处于 sm 断点或更大 */
  isSm: boolean;
  /** 是否处于 md 断点或更大 */
  isMd: boolean;
  /** 是否处于 lg 断点或更大 */
  isLg: boolean;
  /** 是否处于 xl 断点或更大 */
  isXl: boolean;
  /** 是否处于 2xl 断点或更大 */
  is2xl: boolean;
}

/**
 * 检查是否在浏览器环境
 */
const hasWindow =
  typeof globalThis !== "undefined" && globalThis.window !== undefined;

/**
 * 断点检测 Hook
 *
 * 监听窗口大小变化，返回当前激活的断点和各断点布尔值
 * SSR 安全：服务端渲染时返回安全默认值
 *
 * @returns 断点状态对象
 * @example
 * ```tsx
 * const { breakpoint, isMd, isLg } = useBreakpoint();
 *
 * if (isLg) {
 *   // 大屏幕布局
 * } else if (isMd) {
 *   // 中等屏幕布局
 * } else {
 *   // 小屏幕布局
 * }
 * ```
 */
export function useBreakpoint(): UseBreakpointReturn {
  // 初始化宽度，SSR 环境下返回 0
  const [width, setWidth] = React.useState<number>(
    hasWindow ? globalThis.window.innerWidth : 0,
  );

  React.useEffect(() => {
    if (!hasWindow) return;

    let rafId: number | undefined;

    const handleResize = () => {
      if (rafId !== undefined) return;
      rafId = globalThis.window.requestAnimationFrame(() => {
        setWidth(globalThis.window.innerWidth);
        rafId = undefined;
      });
    };

    globalThis.window.addEventListener("resize", handleResize);
    return () => {
      globalThis.window.removeEventListener("resize", handleResize);
      if (rafId !== undefined) globalThis.window.cancelAnimationFrame(rafId);
    };
  }, []);

  // 计算当前断点
  const breakpoint = getBreakpoint(width);

  return {
    breakpoint,
    isSm: width >= breakpoints.sm,
    isMd: width >= breakpoints.md,
    isLg: width >= breakpoints.lg,
    isXl: width >= breakpoints.xl,
    is2xl: width >= breakpoints["2xl"],
  };
}
