/**
 * portal-context.utils.ts - 跨 Portal 导航上下文工具函数
 * @package @vxture-platform/shared
 * @description 序列化 / 反序列化 PortalNavContext，用于跨 Portal URL 参数传递。
 *   使用 URLSearchParams + JSON，兼容 Node.js 18+ 和现代浏览器。
 */

import type { PortalNavContext } from "../types/portal-context.types";

const CTX_PARAM = "ctx";

// =============================================================================
// 序列化
// =============================================================================

/**
 * 将 PortalNavContext 序列化为 URL 查询字符串（不含前导 `?`）。
 *
 * @example
 * const qs = encodePortalContext({ from: 'website', returnTo: 'https://...', caller: 'Vxture 官网' });
 * const url = `${CONSOLE_URL}?${qs}`;
 *
 * @param ctx - 跨 Portal 导航上下文
 * @returns URLSearchParams 格式的查询字符串
 */
export function encodePortalContext(ctx: PortalNavContext): string {
  return new URLSearchParams({ [CTX_PARAM]: JSON.stringify(ctx) }).toString();
}

// =============================================================================
// 反序列化
// =============================================================================

/**
 * 从 URL 查询字符串中反序列化 PortalNavContext。
 * 解析失败或字段缺失时返回 null，调用方负责降级处理。
 *
 * @param search - URL 查询字符串，可带或不带前导 `?`
 * @returns 解析后的 PortalNavContext，或 null
 *
 * @security `returnTo` 字段仅验证类型，不验证 URL 合法性。
 *   调用方在使用前**必须**自行校验：
 *   1. 用 `new URL(returnTo)` 构造器确认合法 URL
 *   2. 校验 origin 在白名单内，防止开放重定向
 */
export function decodePortalContext(search: string): PortalNavContext | null {
  try {
    const params = new URLSearchParams(search.replace(/^\?/, ""));
    const raw = params.get(CTX_PARAM);
    if (!raw) return null;

    const decoded = JSON.parse(raw) as Record<string, unknown>;

    // 必填字段校验
    if (
      typeof decoded.from !== "string" ||
      typeof decoded.returnTo !== "string" ||
      typeof decoded.caller !== "string"
    ) {
      return null;
    }

    return decoded as unknown as PortalNavContext;
  } catch {
    return null;
  }
}
