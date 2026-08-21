/**
 * index.ts - Shared type exports
 * @package @vxture-platform/shared
 * @description Unified export entry for all shared types, organized by functional category.
 */

// API Types - Standard HTTP response contracts
export type {
  ApiSuccessResponse,
  ApiErrorResponse,
  ApiResponse,
} from "./api.types";

// Auth Types - Authentication and user information
export type { UserInfo, TokenData } from "./auth.types";

// Common Types - Cross-layer navigation and interaction primitives
export type { Link, Action } from "./common.types";

// Locale Types - Language and localization
export type { Locale, LocaleConfig } from "./locale.types";

// Theme Types - Theme and dark/light mode
export type { Theme, ThemeValue } from "./theme.types";

// UI Types - Cross-layer UI primitives
export type { SemanticColor } from "./ui.types";

// Error Types - 错误元数据类型定义
export type { ErrorMetadata } from "./error.types";

// Portal Context Types - 跨 Portal 导航上下文
export type { PortalSource, PortalNavContext } from "./portal-context.types";

// Entitlement envelope contracts - C2/C3 response face (product_220 §3 / product_310)
export type {
  SubscriptionFacts,
  SaleAxes,
  QuotaPoolView,
  ProductEntitlementView,
  EntitlementResponseSingle,
  EntitlementResponseBatch,
  ConsumeResponseBody,
} from "./entitlement.types";
