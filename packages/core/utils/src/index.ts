/**
 * index.ts - Vxture Core Utilities Package
 * @package @vxture/core-utils
 * @description
 *   Platform-level utilities for Vxture, including logging and error handling.
 */

// ============================================
// Utils Types
// ============================================

export type {
  Maybe,
  Nullable,
  Optional,
  Class,
  FunctionType,
  DeepPartial,
  DeepReadonly,
  LogRecord,
  LoggerConfig,
} from "./types/utils.types";
export { LogLevel, DEFAULT_LOGGER_CONFIG } from "./types/utils.types";

// ============================================
// Utils Functions & Classes
// ============================================

export {
  getNodeEnv,
  isProduction,
  isDevelopment,
  isTest,
  isStaging,
  isNode,
  isBrowser,
  VxLogger,
  logger,
  isString,
  isNumber,
  isBoolean,
  isFunction,
  isSymbol,
  isDefined,
  isNotNull,
  isPresent,
  isObject,
  isArray,
  isEmptyObject,
  isEmptyArray,
  isNonEmptyString,
  isValidUrl,
  isUuid,
  normalizePhoneNumber,
  toE164,
  DEFAULT_PHONE_COUNTRY,
  extractClientIp,
  chooseDevFallback,
} from "./utils";

export type {
  NormalizedPhone,
  ClientIpRequest,
  DevFallbackChoice,
} from "./utils";

// ============================================
// Product Taxonomy (product_type 单一权威源)
// ============================================

export {
  PRODUCT_TYPES,
  PRODUCT_TYPE_DEFS,
  isValidProductType,
  productTypeFamily,
  productTypeLabel,
} from "./product-taxonomy";
export type {
  ProductType,
  ProductTypeFamily,
  ProductTypeDef,
} from "./product-taxonomy";

// ============================================
// Release Stage (product 成熟度轴单一权威源)
// ============================================

export {
  RELEASE_STAGES,
  RELEASE_STAGE_DEFS,
  isValidReleaseStage,
  releaseStageLabel,
  isReleaseStageSubscribable,
} from "./release-stage";
export type { ReleaseStage, ReleaseStageDef } from "./release-stage";
