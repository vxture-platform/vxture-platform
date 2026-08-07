/**
 * useFullscreen.ts - 全屏系统 Hook
 * @package @vxture/design-ui
 *
 * 功能：提供访问全屏系统状态和操作的简化 Hook
 *       isNativeSupported 直接从 context 读取，不重复实现
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Hooks
 */

import { useCallback } from "react";
import { useFullscreenContext } from "../components/layout/fullscreen/Provider";
import type { FullscreenOptions } from "../types/fullscreen";

export function useFullscreen() {
  const context = useFullscreenContext();

  const enter = useCallback(
    (id: string, element: HTMLElement, options?: FullscreenOptions) => {
      context.enterFullscreen(id, element, options);
    },
    [context.enterFullscreen],
  );

  const exit = useCallback(() => {
    context.exitFullscreen();
  }, [context.exitFullscreen]);

  const toggle = useCallback(
    (id: string, element: HTMLElement, options?: FullscreenOptions) => {
      context.toggleFullscreen(id, element, options);
    },
    [context.toggleFullscreen],
  );

  const isTargetFullscreen = useCallback(
    (id: string): boolean => {
      return context.isFullscreen && context.targetId === id;
    },
    [context.isFullscreen, context.targetId],
  );

  return {
    ...context,
    enter,
    exit,
    toggle,
    isTargetFullscreen,
  };
}
