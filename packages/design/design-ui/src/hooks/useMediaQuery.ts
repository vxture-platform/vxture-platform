/**
 * useMediaQuery.ts - 媒体查询检测 Hook
 * @package @vxture/design-ui
 *
 * 功能：检测媒体查询匹配状态
 *
 * @copyright Vxture Team
 * @layer Presentation
 * @category Hooks
 */

import { useSyncExternalStore } from "react";

/**
 * 媒体查询检测 Hook
 *
 * @param query CSS 媒体查询字符串
 * @returns 是否匹配该媒体查询
 *
 * @example
 * const isMobile = useMediaQuery("(max-width: 768px)");
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    () =>
      typeof window !== "undefined" ? window.matchMedia(query).matches : false,
    () => false,
  );
}
