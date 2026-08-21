/**
 * debug.utils.ts - Debug utility functions
 * @package @vxture-platform/shared
 * @description Environment-aware debug logging functions with automatic detection of development/production environments.
 */

function isDev(): boolean {
  // Node.js 环境
  if (typeof process !== "undefined" && process.env["NODE_ENV"] !== undefined) {
    return process.env["NODE_ENV"] === "development";
  }

  // 浏览器环境（仅 ESM 格式） — use dynamic access to avoid DOM lib requirement
  const loc = (globalThis as Record<string, unknown>)["location"];
  if (typeof loc === "object" && loc !== null) {
    const hostname = String((loc as Record<string, unknown>)["hostname"] ?? "");
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    );
  }

  // 默认返回 false
  return false;
}

export function debugLog(...args: unknown[]): void {
  if (isDev()) console.log("[debug]", ...args);
}

export function debugWarn(...args: unknown[]): void {
  if (isDev()) console.warn("[warn]", ...args);
}

export function debugError(...args: unknown[]): void {
  if (isDev()) console.error("[error]", ...args);
}
