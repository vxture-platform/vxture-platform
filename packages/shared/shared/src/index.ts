/**
 * index.ts - @vxture-platform/shared entry point
 * @package @vxture-platform/shared
 * @description Main entry point for the @vxture-platform/shared package, exporting all public API types, constants, and utility functions.
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

// 三个主体可视码的展示形状（U- / T- / W-）。界面一律带前缀，前缀在此收口。
export {
  principalPrefix,
  formatPrincipalNo,
  formatPrincipalNoOr,
  normalizePrincipalNoInput,
  validatePrincipalNo,
} from "./principal-no";
export type { PrincipalKind, PrincipalNoProblem } from "./principal-no";

// Catalog value-domain types — platform contract (product_220 §1/§2/§3)
export type {
  Tier,
  ComponentRole,
  PlanVersionStatus,
  SubscriptionStatus,
  BillStatus,
  PaySource,
  TicketStatus,
  UserKycStatus,
  TicketPriority,
  MergeStrategy,
  ConsumeMode,
  MetricKind,
  ProductLayerValue,
} from "./constants";

// Atlas 对象状态 —— 上游契约在消费侧的镜像（product_251 M-B3）。opera 与 admin 读同一批
// 记录，词表与「deprecated 算不算在服务」的判断只能有一份；见
// constants/atlas-state.constants.ts 文件头。
export type { ObjectState, ModelState, KeyState } from "./constants";
export {
  OBJECT_STATES,
  MODEL_STATES,
  KEY_STATES,
  isEnabled,
  isServing,
  isInForce,
} from "./constants";

// 业务状态 → 展示语气的映射（跨门户共用；不进 DS，DS 零业务语义）
export type { StatusTone } from "./constants";
export {
  SUBSCRIPTION_STATUS_TONE,
  TIER_TONE,
  PLAN_VERSION_STATUS_TONE,
  TICKET_STATUS_TONE,
  USER_KYC_STATUS_TONE,
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
  // Theme / preference 持久化键已迁入 @vxture/design-tokens（2026-08-21 归属纠正）
  // UI constants
  SEMANTIC_COLORS,
  // Catalog value domains — platform contract, SoT (product_220 §1/§2/§3)
  TIERS,
  COMPONENT_ROLES,
  PLAN_VERSION_STATUSES,
  SUBSCRIPTION_STATUSES,
  BILL_STATUSES,
  PAY_SOURCES,
  TICKET_STATUSES,
  USER_KYC_STATUSES,
  TICKET_PRIORITIES,
  MERGE_STRATEGIES,
  CONSUME_MODES,
  METRIC_KINDS,
  // 定位轴 L1/L2/L3（product_100_matrix §2）——与类型轴、来源轴正交
  PRODUCT_LAYERS,
  PRODUCT_LAYER_DEFS,
  isValidProductLayer,
  productLayerLabel,
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
  formatClock,
  formatDateTime,
  formatDay,
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

// 上游响应契约断言（机制；词表留在各消费方仓内）
export { makeContractAssert } from "./contracts";
export type {
  ContractTable,
  ContractViolation,
  PayloadShape,
  ResourceContract,
  ViolationFactory,
} from "./contracts";

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

// 日期形态的输入类型（formatDay / formatDateTime 的参数）
export type { DateInput } from "./utils/format.utils";

// 官网品牌名的单一权威(owner 2026-09-10:tab 标题漏改)。
export { BRAND_NAME, BRAND_TITLE } from "./constants";

// 备案信息的单一权威(owner 2026-09-20)。**不进 i18n 词条**:备案号是法定标识、
// 不随语言变化——此前挂在 messages 下被当成"待翻译文案",en-US 两处留空,
// 英文页面一个备案号都不显示。官网页脚与 accounts 登录页页脚现在读同一份。
export { ICP_FILING, PUBLIC_SECURITY_FILING, SITE_FILINGS } from "./constants";
export type { SiteFiling } from "./constants";
