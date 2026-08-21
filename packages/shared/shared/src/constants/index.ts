/**
 * index.ts - Shared constant exports
 * @package @vxture/shared
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
export * from "./status-tone.constants";
export * from "./nav-preference.constants";
