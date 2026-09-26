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
