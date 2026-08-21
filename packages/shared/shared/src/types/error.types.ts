/**
 * error.types.ts - 错误相关类型定义
 * @package @vxture-platform/shared
 * @description
 *   错误元数据和相关类型定义，供所有 @vxture/* 包使用
 */

export interface ErrorMetadata {
  code?: string;
  status?: number;
  details?: unknown;
  requestId?: string;
}
