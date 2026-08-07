/**
 * Provider.tsx - 全屏系统 Provider
 * @package @vxture/design-ui
 *
 * 功能：管理全屏状态，提供统一的全屏操作接口
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  FullscreenContextValue,
  FullscreenMode,
  FullscreenOptions,
  FullscreenProviderProps,
  FullscreenState,
} from "../../../types/fullscreen";

// ─── Context ───────────────────────────────────────────────────────────────────

const FullscreenContext = createContext<FullscreenContextValue | undefined>(
  undefined,
);

const DEFAULT_MODE: FullscreenMode = "pseudo";
const DEFAULT_LOCK_SCROLL = true;

interface VendorFullscreenElement extends HTMLElement {
  readonly webkitRequestFullscreen?: () => Promise<void> | void;
  readonly mozRequestFullScreen?: () => Promise<void> | void;
  readonly msRequestFullscreen?: () => Promise<void> | void;
}

interface VendorFullscreenDocument extends Document {
  readonly webkitFullscreenElement?: Element | null;
  readonly mozFullScreenElement?: Element | null;
  readonly msFullscreenElement?: Element | null;
  readonly webkitExitFullscreen?: () => Promise<void> | void;
  readonly mozCancelFullScreen?: () => Promise<void> | void;
  readonly msExitFullscreen?: () => Promise<void> | void;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function FullscreenProvider({
  children,
  defaultMode = DEFAULT_MODE,
  defaultLockScroll = DEFAULT_LOCK_SCROLL,
}: FullscreenProviderProps) {
  const [state, setState] = useState<FullscreenState>({
    isFullscreen: false,
    mode: defaultMode,
    targetId: undefined,
  });

  const originalOverflowRef = useRef<string | null>(null);
  const activeElementRef = useRef<HTMLElement | null>(null);
  // 记录当次全屏是否锁定了滚动，退出时对应解锁
  const isScrollLockedRef = useRef(false);

  // ─── 原生全屏能力检测 ──────────────────────────────────────────────────────

  const isNativeSupported = useCallback((): boolean => {
    const element = document.documentElement as VendorFullscreenElement;
    return !!(
      element.requestFullscreen ||
      element.webkitRequestFullscreen ||
      element.mozRequestFullScreen ||
      element.msRequestFullscreen
    );
  }, []);

  // ─── 原生全屏操作 ──────────────────────────────────────────────────────────

  const enterNativeFullscreen = useCallback(async (element: HTMLElement) => {
    const target = element as VendorFullscreenElement;
    try {
      if (target.requestFullscreen) {
        await target.requestFullscreen();
      } else if (target.webkitRequestFullscreen) {
        await target.webkitRequestFullscreen();
      } else if (target.mozRequestFullScreen) {
        await target.mozRequestFullScreen();
      } else if (target.msRequestFullscreen) {
        await target.msRequestFullscreen();
      }
    } catch (error) {
      console.warn(
        "Failed to enter native fullscreen, falling back to pseudo:",
        error,
      );
    }
  }, []);

  const exitNativeFullscreen = useCallback(async () => {
    const fullscreenDocument = document as VendorFullscreenDocument;
    try {
      if (fullscreenDocument.exitFullscreen) {
        await fullscreenDocument.exitFullscreen();
      } else if (fullscreenDocument.webkitExitFullscreen) {
        await fullscreenDocument.webkitExitFullscreen();
      } else if (fullscreenDocument.mozCancelFullScreen) {
        await fullscreenDocument.mozCancelFullScreen();
      } else if (fullscreenDocument.msExitFullscreen) {
        await fullscreenDocument.msExitFullscreen();
      }
    } catch (error) {
      console.warn("Failed to exit native fullscreen:", error);
    }
  }, []);

  // ─── 滚动锁定 ──────────────────────────────────────────────────────────────

  const lockScroll = useCallback(() => {
    if (originalOverflowRef.current === null) {
      originalOverflowRef.current = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      isScrollLockedRef.current = true;
    }
  }, []);

  const unlockScroll = useCallback(() => {
    if (isScrollLockedRef.current && originalOverflowRef.current !== null) {
      document.body.style.overflow = originalOverflowRef.current;
      originalOverflowRef.current = null;
      isScrollLockedRef.current = false;
    }
  }, []);

  // ─── 进入 / 退出 / 切换全屏 ────────────────────────────────────────────────

  const enterFullscreen = useCallback(
    (id: string, element: HTMLElement, options?: FullscreenOptions) => {
      const targetMode = options?.mode ?? state.mode;
      // 优先使用调用方传入的 lockScroll，其次使用 Provider 全局默认值
      const shouldLock = options?.lockScroll ?? defaultLockScroll;

      activeElementRef.current = element;

      if (targetMode === "native" && isNativeSupported()) {
        enterNativeFullscreen(element);
      }

      if (shouldLock) {
        lockScroll();
      } else {
        // 确保上次残留的锁定状态被清除
        isScrollLockedRef.current = false;
      }

      setState({ isFullscreen: true, targetId: id, mode: targetMode });
    },
    [
      state.mode,
      defaultLockScroll,
      isNativeSupported,
      enterNativeFullscreen,
      lockScroll,
    ],
  );

  const exitFullscreen = useCallback(() => {
    if (state.mode === "native") {
      exitNativeFullscreen();
    }

    unlockScroll();
    activeElementRef.current = null;

    setState({ isFullscreen: false, targetId: undefined, mode: state.mode });
  }, [state.mode, exitNativeFullscreen, unlockScroll]);

  const toggleFullscreen = useCallback(
    (id: string, element: HTMLElement, options?: FullscreenOptions) => {
      if (state.isFullscreen && state.targetId === id) {
        exitFullscreen();
      } else {
        enterFullscreen(id, element, options);
      }
    },
    [state.isFullscreen, state.targetId, enterFullscreen, exitFullscreen],
  );

  // ─── 键盘 / 原生全屏事件监听 ───────────────────────────────────────────────

  /** ESC 退出 pseudo 全屏 */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        state.isFullscreen &&
        state.mode === "pseudo"
      ) {
        exitFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.isFullscreen, state.mode, exitFullscreen]);

  /** 监听浏览器原生全屏退出（用户按 ESC 触发的原生退出） */
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenDocument = document as VendorFullscreenDocument;
      const isInNativeFullscreen = !!(
        fullscreenDocument.fullscreenElement ||
        fullscreenDocument.webkitFullscreenElement ||
        fullscreenDocument.mozFullScreenElement ||
        fullscreenDocument.msFullscreenElement
      );

      if (
        !isInNativeFullscreen &&
        state.isFullscreen &&
        state.mode === "native"
      ) {
        unlockScroll();
        setState((prev) => ({
          ...prev,
          isFullscreen: false,
          targetId: undefined,
        }));
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange,
      );
      document.removeEventListener(
        "mozfullscreenchange",
        handleFullscreenChange,
      );
      document.removeEventListener(
        "MSFullscreenChange",
        handleFullscreenChange,
      );
    };
  }, [state.isFullscreen, state.mode, unlockScroll]);

  /** 组件卸载时清理 */
  useEffect(() => {
    return () => {
      if (state.isFullscreen) {
        unlockScroll();
        if (state.mode === "native") {
          exitNativeFullscreen();
        }
      }
    };
  }, [state.isFullscreen, state.mode, unlockScroll, exitNativeFullscreen]);

  // ─── Context Value ─────────────────────────────────────────────────────────

  const contextValue: FullscreenContextValue = {
    ...state,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  };

  return (
    <FullscreenContext.Provider value={contextValue}>
      {children}
    </FullscreenContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * 访问全屏上下文，必须在 FullscreenProvider 内部使用
 */
export function useFullscreenContext(): FullscreenContextValue {
  const context = useContext(FullscreenContext);
  if (!context) {
    throw new Error(
      "useFullscreenContext must be used within a FullscreenProvider",
    );
  }
  return context;
}
