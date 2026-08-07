/**
 * index.ts - @vxture/shared entry point
 * @package @vxture/shared
 * @description Main entry point for the @vxture/shared package, exporting all public API types, constants, and utility functions.
 */

// =============================================================================
// Exports
// =============================================================================

// Type Exports
export type {
  // API Types
  ApiSuccessResponse,
  ApiErrorResponse,
  ApiResponse,
  // Auth Types
  UserInfo,
  TokenData,
  // Common Types
  Link,
  Action,
  // Locale Types
  Locale,
  LocaleConfig,
  // Theme Types
  Theme,
  ThemeValue,
  // UI Types
  SemanticColor,
  // Error Types
  ErrorMetadata,
  // Portal Context Types
  PortalSource,
  PortalNavContext,
  // C2/C3 entitlement envelope contract (product_220 §3 / product_310)
  SubscriptionFacts,
  SaleAxes,
  QuotaPoolView,
  ProductEntitlementView,
  EntitlementResponseSingle,
  EntitlementResponseBatch,
  ConsumeResponseBody,
} from "./types";

// Catalog value-domain types — platform contract (product_220 §1/§2/§3)
export type {
  Tier,
  ComponentRole,
  PlanVersionStatus,
  SubscriptionStatus,
  MergeStrategy,
  ConsumeMode,
  MetricKind,
} from "./constants";

// 业务状态 → 展示语气的映射（跨门户共用；不进 DS，DS 零业务语义）
export type { StatusTone } from "./constants";
export {
  SUBSCRIPTION_STATUS_TONE,
  TIER_TONE,
  PLAN_VERSION_STATUS_TONE,
  resolveStatusTone,
} from "./constants";

// 侧栏收起态的 cookie 约定（服务端 layout 与客户端外壳共用；不进 DS，那边是
// "use client" 入口，服务端 import 会在 RSC 边界上报错）
export {
  navCollapsedCookieName,
  readNavCollapsed,
  writeNavCollapsed,
} from "./constants";

// Value Exports
export {
  // Auth constants
  AUTH_CONSTANTS,
  // Locale constants
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_CONFIGS,
  LOCALE_DEFAULT_CURRENCY,
  LOCALE_CONSTANTS,
  // Theme constants
  THEME_CONSTANTS,
  // Preference constants
  PREFERENCE_CONSTANTS,
  // UI constants
  SEMANTIC_COLORS,
  // Catalog value domains — platform contract, SoT (product_220 §1/§2/§3)
  TIERS,
  COMPONENT_ROLES,
  PLAN_VERSION_STATUSES,
  SUBSCRIPTION_STATUSES,
  MERGE_STRATEGIES,
  CONSUME_MODES,
  METRIC_KINDS,
} from "./constants";

// Utils
export {
  // Debug utils
  debugLog,
  debugWarn,
  debugError,
  // Format utils
  formatCurrency,
  formatDate,
  formatNumber,
  // Object utils
  deepMerge,
  deepClone,
  isPlainObject,
  // Portal Context utils
  encodePortalContext,
  decodePortalContext,
  // Health / identity endpoint contract (standard 025)
  serviceIdentity,
  buildHealthIdentity,
} from "./utils";

// Health / identity endpoint contract types (standard 025)
export type { ServiceIdentity, HealthLiveResponse } from "./utils";

// Errors
export {
  VxtureError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  InternalServerError,
  isVxtureError,
} from "./errors";
