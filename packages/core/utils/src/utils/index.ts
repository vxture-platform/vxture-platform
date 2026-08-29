/**
 * index.ts - Core utils function exports
 * @package @vxture/core-utils
 */

export {
  getNodeEnv,
  isProduction,
  isDevelopment,
  isTest,
  isStaging,
  isNode,
  isBrowser,
} from "./env.utils";

export { VxLogger, logger } from "./logger.utils";

export { extractClientIp, type ClientIpRequest } from "./http.utils";

export {
  normalizePhoneNumber,
  toE164,
  DEFAULT_PHONE_COUNTRY,
  type NormalizedPhone,
} from "./phone.utils";

export {
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
} from "./type-guards.utils";

export { chooseDevFallback } from "./dev-fallback.utils";
export type { DevFallbackChoice } from "./dev-fallback.utils";
