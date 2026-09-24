/**
 * index.ts - Shared constant exports
 * @package @vxture-platform/shared
 * @description Unified export entry for all shared constants, organized by functional category.
 */

// Auth constants
export { AUTH_CONSTANTS } from "./auth.constants";

// 套餐版本组件指纹：认证记一份、发布门重算比对，算法只此一处
export {
  PLAN_COMPONENT_FINGERPRINT_SQL,
  INTEGRATION_CONTRACT_VERSION,
} from "./plan-fingerprint.constants";

// Locale constants
export {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LOCALE_CONFIGS,
  LOCALE_DEFAULT_CURRENCY,
  LOCALE_CONSTANTS,
} from "./locale.constants";

// Theme constants

// Preference constants

// UI constants
export { SEMANTIC_COLORS } from "./ui.constants";

// Catalog value domains — platform contract, SoT (product_220 §1/§2/§3).
// Pure value sets; business logic lives in the owning domain, not here.
export {
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
  PRODUCT_INTEGRATION_MODES,
  PRODUCT_STATUSES,
  PRODUCT_LAYERS,
  PRODUCT_LAYER_DEFS,
  PRODUCT_LAYER_CHOICES,
  isValidProductLayer,
  isSelectableProductLayer,
  productLayerLabel,
} from "./catalog-domains.constants";
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
  ProductIntegrationMode,
  ProductStatusValue,
  ProductLayerValue,
} from "./catalog-domains.constants";
// Atlas 对象状态 —— 上游契约在消费侧的镜像（product_251 M-B3）。
// 两个门户读同一批记录，词表与「deprecated 算不算在服务」的判断只能有一份；
// 为什么这里连谓词也收，见该文件头（与 catalog-domains 的"零业务逻辑"不冲突）。
export {
  OBJECT_STATES,
  MODEL_STATES,
  KEY_STATES,
  isEnabled,
  isServing,
  isInForce,
} from "./atlas-state.constants";
export type {
  ObjectState,
  ModelState,
  KeyState,
} from "./atlas-state.constants";
export * from "./status-tone.constants";
export * from "./nav-preference.constants";
export {
  BRAND_NAME,
  BRAND_TITLE,
  ICP_FILING,
  PUBLIC_SECURITY_FILING,
  SITE_FILINGS,
} from "./brand.constants";
export type { SiteFiling } from "./brand.constants";
