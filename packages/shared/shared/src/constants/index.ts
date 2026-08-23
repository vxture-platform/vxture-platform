/**
 * index.ts - Shared constant exports
 * @package @vxture-platform/shared
 * @description Unified export entry for all shared constants, organized by functional category.
 */

// Auth constants
export { AUTH_CONSTANTS } from "./auth.constants";

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
  MERGE_STRATEGIES,
  CONSUME_MODES,
  METRIC_KINDS,
} from "./catalog-domains.constants";
export type {
  Tier,
  ComponentRole,
  PlanVersionStatus,
  SubscriptionStatus,
  MergeStrategy,
  ConsumeMode,
  MetricKind,
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
