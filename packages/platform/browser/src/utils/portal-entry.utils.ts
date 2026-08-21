/**
 * portal-entry.utils.ts - 跨 Portal 导航入口工具函数
 * @package @vxture/platform-browser
 * @description 解析、存储、读取跨 Portal 导航上下文（PortalNavContext）。
 *   首次进入时从 URL 解析，会话期间通过 sessionStorage 保持，标签页关闭后自动清除。
 */

import { decodePortalContext } from "@vxture-platform/shared";
import type { PortalNavContext } from "@vxture-platform/shared";

const STORAGE_KEY = "vx-portal-entry-ctx";

// =============================================================================
// URL 解析
// =============================================================================

/**
 * 从当前 URL 查询字符串解析 PortalNavContext。
 * 应在组件首次挂载时调用，后续通过 sessionStorage 维持状态。
 *
 * @returns 解析后的 PortalNavContext，URL 中无 ctx 参数时返回 null
 */
export function parsePortalEntryFromUrl(): PortalNavContext | null {
  if (typeof window === "undefined") return null;
  return decodePortalContext(window.location.search);
}

// =============================================================================
// sessionStorage 读写
// =============================================================================

/**
 * 从 sessionStorage 读取 PortalNavContext。
 * 用于 console 内页面跳转后恢复上下文。
 *
 * @returns 存储的 PortalNavContext，不存在或解析失败时返回 null
 */
export function loadPortalEntry(): PortalNavContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PortalNavContext;
  } catch {
    return null;
  }
}

/**
 * 将 PortalNavContext 写入 sessionStorage。
 * 在从 URL 成功解析后立即调用，保证页面内导航期间上下文不丢失。
 *
 * @param ctx - 跨 Portal 导航上下文
 */
export function savePortalEntry(ctx: PortalNavContext): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
}

/**
 * 从 sessionStorage 清除 PortalNavContext。
 * 用户主动关闭「返回来源」指示时调用。
 */
export function clearPortalEntry(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}
