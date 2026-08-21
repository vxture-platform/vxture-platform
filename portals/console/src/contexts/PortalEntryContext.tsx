/**
 * PortalEntryContext.tsx - 跨 Portal 导航上下文 Provider
 * @package @vxture/console
 * @layer Presentation
 * @category Contexts
 * @author AI-Generated
 * @date 2026-05-06
 */
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { PortalNavContext } from "@vxture-platform/shared";
import {
  parsePortalEntryFromUrl,
  loadPortalEntry,
  savePortalEntry,
  clearPortalEntry,
} from "@vxture/platform-browser";

// =============================================================================
// Context 类型
// =============================================================================

interface PortalEntryContextValue {
  /** 当前跨 Portal 导航上下文，无来源 Portal 时为 null */
  portalEntry: PortalNavContext | null;
  /** 用户主动关闭「返回来源」指示后调用，清除 sessionStorage 并隐藏入口 */
  dismiss: () => void;
}

const PortalEntryContext = createContext<PortalEntryContextValue>({
  portalEntry: null,
  dismiss: () => undefined,
});

// =============================================================================
// Provider
// =============================================================================

export function PortalEntryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [portalEntry, setPortalEntry] = useState<PortalNavContext | null>(null);

  useEffect(() => {
    // 优先从 URL 解析（来源 Portal 首次跳入）
    const fromUrl = parsePortalEntryFromUrl();
    if (fromUrl) {
      savePortalEntry(fromUrl);
      setPortalEntry(fromUrl);
      // 清理 URL ctx 参数，避免污染浏览历史和分享链接
      const url = new URL(window.location.href);
      url.searchParams.delete("ctx");
      window.history.replaceState({}, "", url.toString());
      return;
    }
    // 回退到 sessionStorage（console 内页面跳转后恢复）
    setPortalEntry(loadPortalEntry());
  }, []);

  const dismiss = () => {
    clearPortalEntry();
    setPortalEntry(null);
  };

  return (
    <PortalEntryContext.Provider value={{ portalEntry, dismiss }}>
      {children}
    </PortalEntryContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * 获取当前跨 Portal 导航上下文及关闭操作。
 * 必须在 PortalEntryProvider 子树内使用。
 */
export function usePortalEntry(): PortalEntryContextValue {
  return useContext(PortalEntryContext);
}
