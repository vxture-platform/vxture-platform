/**
 * ThemeProvider.tsx - 主题提供者组件
 * @package @vxture/design-system
 *
 * 功能：提供主题上下文，统一管理 light/dark/system 主题和 UI 密度
 *       由 @vxture/design-system 客户端入口提供 "use client" 边界
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Components - Common
 */

import {
  ThemeProvider as NextThemeProvider,
  useTheme as useNextTheme,
} from "next-themes";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Density } from "../density";
import { DEFAULT_DENSITY, DENSITY_STORAGE_KEY } from "../density";
import { THEME_CONSTANTS } from "@vxture/design-tokens";
import { markAppReady } from "./boot-splash";
import {
  readFontSizePreference,
  writeFontSizePreference,
  subscribeFontSizePreference,
  type FontSizePreference,
} from "./fontSizePreference";

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

/**
 * Theme Context Value
 */
type ThemeContextValue = {
  /** 当前实际渲染主题 */
  theme: "light" | "dark";
  /** 用户选择的主题模式 */
  mode: "light" | "dark" | "system";
  /** 设置主题模式 */
  setMode: (mode: "light" | "dark" | "system") => void;
  /** 切换亮暗主题 */
  toggle: () => void;
  /** 兼容既有调用方的主题设置方法 */
  setTheme: (theme: string) => void;
  /** 当前密度 */
  density: Density;
  /** 设置密度 */
  setDensity: (density: Density) => void;
  /** 当前字号偏好（契约键 vx-fontsize，跨 *.vxture.com 同步） */
  fontSize: FontSizePreference;
  /** 设置字号偏好 */
  setFontSize: (fontSize: FontSizePreference) => void;
};

/**
 * ThemeProvider Props
 */
export type ThemeProviderProps = {
  /** 子组件 */
  readonly children: ReactNode;
  /** 默认主题模式 */
  readonly defaultMode?: "light" | "dark" | "system";
  /** 默认密度 */
  readonly defaultDensity?: Density;
};

// ─── Context ───────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// ─── DensityProvider ──────────────────────────────────────────────────────────

/**
 * 内部 Density Provider
 *
 * 管理 UI 密度状态，挂载后从 localStorage 恢复，并将 density-{value} class
 * 写入 document.documentElement，供 Tailwind 变体或 CSS 变量使用。
 */
function DensityProvider({
  children,
  defaultDensity = DEFAULT_DENSITY,
}: {
  children: ReactNode;
  defaultDensity?: Density;
}) {
  const [density, setDensityState] = useState<Density>(defaultDensity);
  // 用 ref 跟踪挂载状态，避免 useCallback 依赖 mounted state 导致函数频繁重建
  const mountedRef = useRef(false);

  // ── 挂载后从 localStorage 恢复 ────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    /* 让服务端直出的启动占位让位。放在这里是因为 ThemeProvider 已经在四个门户
     * 的根上，且它本来就负责"首帧那些事"（.dark / density / 字号）——再加一个
     * 挂载点只会多一处要记得接的线。 */
    markAppReady();
    const saved = localStorage.getItem(DENSITY_STORAGE_KEY) as Density | null;
    if (
      saved &&
      (["compact", "default", "comfortable"] as Density[]).includes(saved)
    ) {
      setDensityState(saved);
    }
  }, []);

  // ── setDensity：始终写入 localStorage（mountedRef 不触发重渲染）────────────
  const setDensity = useCallback((newDensity: Density) => {
    setDensityState(newDensity);
    // 使用 ref 判断，无论 mounted 时序如何都能正确写入
    if (mountedRef.current) {
      localStorage.setItem(DENSITY_STORAGE_KEY, newDensity);
    }
  }, []); // 无依赖，函数引用稳定

  // ── 同步 density class 到 <html> ──────────────────────────────────────────
  useEffect(() => {
    if (!mountedRef.current) return;
    const root = document.documentElement;
    root.classList.remove(
      "density-compact",
      "density-default",
      "density-comfortable",
    );
    root.classList.add(`density-${density}`);
  }, [density]);

  return (
    <ThemeContext.Consumer>
      {(context) => {
        if (!context) return null;
        return (
          <ThemeContext.Provider value={{ ...context, density, setDensity }}>
            {children}
          </ThemeContext.Provider>
        );
      }}
    </ThemeContext.Consumer>
  );
}

// ─── FontSizeProvider ─────────────────────────────────────────────────────────

/** 将 .vx-font-{value} class 写入 <html>，驱动 tokens-fontsize.css 的根 rem 缩放。 */
function applyFontSizeClass(value: FontSizePreference): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("vx-font-small", "vx-font-default", "vx-font-large");
  root.classList.add(`vx-font-${value}`);
  root.dataset.vxFontSize = value;
}

/**
 * 内部 Font-size Provider
 *
 * 字号偏好是跨 *.vxture.com 全栈同步的契约项（vx-fontsize）。挂载后读取偏好并
 * 应用到 <html>，订阅跨标签页/跨子域名的同步实时跟随；setFontSize 经
 * ./fontSizePreference 持久化（localStorage + `.vxture.com` cookie）。持久化逻辑
 * 内置于 DS（仅依赖 @vxture/design-tokens 契约键），使发布包保持精简、可被外部消费者安装。
 */
function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSizePreference>("default");

  useEffect(() => {
    const initial = readFontSizePreference();
    setFontSizeState(initial);
    applyFontSizeClass(initial);
    return subscribeFontSizePreference((next) => {
      setFontSizeState(next);
      applyFontSizeClass(next);
    });
  }, []);

  const setFontSize = useCallback((next: FontSizePreference) => {
    setFontSizeState(next);
    applyFontSizeClass(next);
    writeFontSizePreference(next);
  }, []);

  return (
    <ThemeContext.Consumer>
      {(context) => {
        if (!context) return null;
        return (
          <ThemeContext.Provider value={{ ...context, fontSize, setFontSize }}>
            {children}
          </ThemeContext.Provider>
        );
      }}
    </ThemeContext.Consumer>
  );
}

// ─── ThemeContextBridge ───────────────────────────────────────────────────────

/**
 * 桥接组件：在 NextThemeProvider 内部读取 next-themes context，
 * 注入自定义 ThemeContext，再嵌套 DensityProvider。
 */
function ThemeContextBridge({
  children,
  defaultDensity,
}: {
  children: ReactNode;
  defaultDensity: Density;
}) {
  const { theme: selectedTheme, resolvedTheme, setTheme } = useNextTheme();
  const mode = normalizeThemeMode(selectedTheme);
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const setMode = useCallback(
    (nextMode: "light" | "dark" | "system") => {
      setTheme(nextMode);
    },
    [setTheme],
  );

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const baseValue: Omit<
    ThemeContextValue,
    "density" | "setDensity" | "fontSize" | "setFontSize"
  > = {
    theme,
    mode,
    setMode,
    toggle,
    setTheme,
  };

  return (
    <ThemeContext.Provider value={baseValue as ThemeContextValue}>
      <DensityProvider defaultDensity={defaultDensity}>
        <FontSizeProvider>{children}</FontSizeProvider>
      </DensityProvider>
    </ThemeContext.Provider>
  );
}

// ─── ThemeProvider ────────────────────────────────────────────────────────────

/**
 * 主题提供者组件
 *
 * 封装 next-themes 的 ThemeProvider，统一管理主题和 UI 密度。
 * 默认跟随系统偏好（system），通过 CSS class 驱动 Tailwind dark 模式。
 *
 * @example
 * ```tsx
 * <ThemeProvider defaultMode="system" defaultDensity="default">
 *   <App />
 * </ThemeProvider>
 * ```
 */
export function ThemeProvider({
  children,
  defaultMode = "system",
  defaultDensity = DEFAULT_DENSITY,
}: ThemeProviderProps) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme={defaultMode}
      storageKey={THEME_CONSTANTS.STORAGE_KEY}
      enableSystem
    >
      <ThemeContextBridge defaultDensity={defaultDensity}>
        {children}
      </ThemeContextBridge>
    </NextThemeProvider>
  );
}

// ─── useTheme ─────────────────────────────────────────────────────────────────

/**
 * 使用主题 Hook
 *
 * 必须在 ThemeProvider 内部使用，返回当前主题和密度及其设置方法。
 *
 * @example
 * ```tsx
 * const { theme, setTheme, density, setDensity } = useTheme();
 * setTheme('dark');
 * setDensity('comfortable');
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

function normalizeThemeMode(
  value: string | undefined,
): "light" | "dark" | "system" {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return "system";
}
