/**
 * API 客户端基础配置
 * @package @vxture/website
 * @layer Presentation
 * @category API
 */

import axios from "axios";

function normalizeOrigin(value: string | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, "");
  if (!normalized) {
    return "http://localhost:3001";
  }
  return normalized;
}

function resolveWebsiteApiPrefix(): string {
  const explicitPrefix = process.env.NEXT_PUBLIC_WEBSITE_API_PREFIX;
  if (explicitPrefix !== undefined) {
    return explicitPrefix.trim().replace(/\/+$/, "");
  }

  // 默认直连 website-bff；只有显式配置统一 API 网关时才保留 /website-api 前缀。
  const usesDirectWebsiteBff =
    Boolean(process.env.NEXT_PUBLIC_WEBSITE_BFF_URL?.trim()) ||
    !process.env.NEXT_PUBLIC_API_URL?.trim();
  return usesDirectWebsiteBff ? "" : "/website-api";
}

const API_ORIGIN = normalizeOrigin(
  process.env.NEXT_PUBLIC_WEBSITE_BFF_URL ?? process.env.NEXT_PUBLIC_API_URL,
);
const API_PREFIX = resolveWebsiteApiPrefix();
/**
 * Resolved website-bff base (origin + optional gateway prefix). Exported so the
 * OIDC-RP browser entries (/auth/login, /auth/logout) — which live at the BFF
 * root, outside the legacy /api/* seam — can be built against the same origin.
 */
export const API_BASE_URL = `${API_ORIGIN}${API_PREFIX}`;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// ─── 响应拦截器 ───────────────────────────────────────────────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    // 401 是"未登录"的预期响应，静默透传，不打印噪音
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      return Promise.reject(error);
    }

    // 其他非预期错误才打印，方便排查真实问题
    console.error("[api] 请求错误:", error);
    return Promise.reject(error);
  },
);
