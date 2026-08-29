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
