/**
 * index.ts - core-locale package entry
 * @package @vxture/core-locale
 * @description
 *   Server-side locale resolution and content localization toolkit, framework-agnostic, runs in Node.js environment
 */

// ============================================================================
// Re-exports from @vxture-platform/shared
// ============================================================================

// Export Locale type and constants defined in shared package
export type { Locale } from "@vxture-platform/shared";
export { SUPPORTED_LOCALES, DEFAULT_LOCALE } from "@vxture-platform/shared";

export type { LocaleRequest } from "./types";

// ============================================================================
// Service-side Locale Utils
// ============================================================================

export { resolveLocale, localizeContent } from "./utils";
