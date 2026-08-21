/**
 * index.ts - Shared utility function exports
 * @package @vxture-platform/shared
 * @description Unified export entry for all shared utility functions, organized by functional category.
 */

// Debug utils
export { debugLog, debugWarn, debugError } from "./debug.utils";

// Format utils
export { formatCurrency, formatDate, formatNumber } from "./format.utils";

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
