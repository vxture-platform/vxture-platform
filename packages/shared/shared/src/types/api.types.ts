/**
 * api.types.ts - Shared API response types
 * @package @vxture-platform/shared
 * @description Standard HTTP response contracts used across BFF, frontend, and core-api. Provides a unified API response structure for consistency.
 */

/** 标准 API 成功响应结构 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/** 标准 API 错误响应结构 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  /** Unix timestamp in milliseconds */
  timestamp: number;
}

/** 标准 API 响应联合类型 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
