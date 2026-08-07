/**
 * fullscreen.ts - 全屏系统类型定义
 * @package @vxture/design-ui
 *
 * 功能：定义全屏系统的所有类型
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Types
 */

export type FullscreenMode = "pseudo" | "native";

// ─── 进入/切换全屏时的选项 ──────────────────────────────────────────────────────

/**
 * enterFullscreen / toggleFullscreen 的调用选项
 *
 * @property mode       - 全屏模式，覆盖 Provider 的 defaultMode
 * @property lockScroll - 是否禁止页面滚动，覆盖 Provider 的 defaultLockScroll
 *                        true（默认）：锁定 body overflow，防止背景滚动
 *                        false：保留滚动能力（适合内容本身需要滚动的场景）
 */
export interface FullscreenOptions {
  mode?: FullscreenMode | undefined;
  lockScroll?: boolean | undefined;
}

export interface FullscreenState {
  isFullscreen: boolean;
  targetId?: string | undefined;
  mode: FullscreenMode;
}

export interface FullscreenContextValue extends FullscreenState {
  enterFullscreen: (
    id: string,
    element: HTMLElement,
    options?: FullscreenOptions,
  ) => void;
  exitFullscreen: () => void;
  toggleFullscreen: (
    id: string,
    element: HTMLElement,
    options?: FullscreenOptions,
  ) => void;
}

export interface FullscreenProviderProps {
  children: React.ReactNode;
  /** 默认全屏模式，可在调用时通过 options.mode 覆盖 */
  defaultMode?: FullscreenMode;
  /**
   * 是否默认禁止页面滚动
   * @default true
   * 可在调用时通过 options.lockScroll 覆盖
   */
  defaultLockScroll?: boolean;
}

export interface FullscreenContainerProps {
  id: string;
  mode?: FullscreenMode | undefined;
  /** 是否禁止页面滚动，覆盖 Provider 的 defaultLockScroll */
  lockScroll?: boolean | undefined;
  portal?: boolean | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}

export interface FullscreenContainerRef {
  /**
   * 进入全屏
   */
  enter: () => void;
  /**
   * 退出全屏
   */
  exit: () => void;
  /**
   * 切换全屏
   */
  toggle: () => void;
}

export interface FullscreenToggleProps {
  targetId: string;
  mode?: FullscreenMode | undefined;
  /** 是否禁止页面滚动，覆盖 Provider 的 defaultLockScroll */
  lockScroll?: boolean | undefined;
  className?: string | undefined;
  children?: React.ReactNode | undefined;
}

export interface FullscreenPortalProps {
  children: React.ReactNode;
}
