/**
 * index.ts - Shared utility function exports
 * @package @vxture-platform/shared
 * @description Unified export entry for all shared utility functions, organized by functional category.
 */

// Debug utils
export { debugLog, debugWarn, debugError } from "./debug.utils";

// Format utils
export {
  formatClock,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDay,
  formatNumber,
  PLATFORM_TIME_ZONE,
} from "./format.utils";
export type { DateInput } from "./format.utils";

// 配额周期：锚定推进（铁律五）。算式只此一份，三个消费方都引它。
export {
  addCyclePeriod,
  addUtcMonths,
  anchoredPeriodStart,
  needsQuotaReset,
  renewalRestartsPeriod,
} from "./quota-period.utils";
export type { QuotaResetPeriod } from "./quota-period.utils";

// Time zone — IANA 校验与民用日期投影（owner 裁定 4：用量日表默认 UTC，用户设了按用户时区）。
// 判据只此一份：service-account 的资料写路径与 service-subscription 的用量读路径都引它。
export {
  USAGE_REBUCKET_HORIZON_DAYS,
  civilDateInZone,
  isIanaTimeZone,
} from "./time-zone.utils";
export type { CivilDate } from "./time-zone.utils";

// Object utils
export { deepMerge, deepClone, isPlainObject } from "./object.utils";

// Portal Context utils
export {
  encodePortalContext,
  decodePortalContext,
} from "./portal-context.utils";

// Health / identity endpoint contract (standard 025)
export { serviceIdentity, buildHealthIdentity } from "./health.utils";
export type { ServiceIdentity, HealthLiveResponse } from "./health.utils";

// Read scope — ReadScope → SQL 谓词（见 types/read-scope.types.ts 文件头）
export { scopeCondition, describeScope } from "./read-scope.utils";
export type { ScopeCondition } from "./read-scope.utils";
