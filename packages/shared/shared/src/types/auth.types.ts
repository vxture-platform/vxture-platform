/**
 * auth.types.ts - Shared authentication types
 * @package @vxture-platform/shared
 * @description Pure data types for authentication and user information, shared across all layers. Contains only structural types without runtime behavior.
 */

// =============================================================================
// Shared Authentication Types
// =============================================================================

/**
 * 已认证用户的基础信息，跨层共用
 */
export interface UserInfo {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  permissions: string[];
  /** Unix timestamp in milliseconds */
  lastLogin?: number;
}

/**
 * Token 数据结构，跨层共用
 */
export interface TokenData {
  token: string;
  refreshToken: string;
  /** Token expiry duration in seconds */
  expiresIn: number;
}
