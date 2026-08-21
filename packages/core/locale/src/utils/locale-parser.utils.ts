/**
 * locale-parser.utils.ts - Language parsing utilities
 * @package @vxture/core-locale
 * @description
 *   Language parsing utility functions
 *
 * @author AI-Generated
 * @date 2026-03-16
 */

import type { Locale } from "@vxture-platform/shared";
import { SUPPORTED_LOCALES } from "@vxture-platform/shared";

// ============================================================================
// Accept-Language parsing
// ============================================================================

/**
 * Parses Accept-Language header string, returns language list sorted by q value
 *
 * @example
 * parseAcceptLanguage('zh-CN,zh;q=0.9,en;q=0.8')
 * // → ['zh-cn', 'zh', 'en']
 */
export function parseAcceptLanguage(header: string): string[] {
  return header
    .split(",")
    .map((entry) => {
      const [lang, q] = entry.trim().split(";q=");
      return {
        lang: lang?.trim().toLowerCase() ?? "",
        quality: q ? parseFloat(q) : 1.0,
      };
    })
    .filter((e) => e.lang.length > 0)
    .sort((a, b) => b.quality - a.quality)
    .map((e) => e.lang);
}

// ============================================================================
// Language normalization
// ============================================================================

/**
 * Normalizes various language string formats to platform-supported Locale
 *
 * Supported input formats:
 * - 'zh' / 'zh-CN' / 'zh-Hans' / 'zh-TW'  → 'zh-CN'
 * - 'en' / 'en-US' / 'en-GB'               → 'en-US'
 * - Other unknown languages                → undefined
 */
export function normalizeLocale(raw: string): Locale | undefined {
  const lower = raw.trim().toLowerCase();

  // Exact match: directly hit supported list
  if (isSupportedLocale(lower)) return lower as Locale;

  // Prefix match: map language primary tag to default region
  const primary = lower.split("-")[0];
  if (primary === "zh") return "zh-CN";
  if (primary === "en") return "en-US";

  return undefined;
}

// ============================================================================
// Type guard
// ============================================================================

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

// ============================================================================
// Cookie parsing
// ============================================================================

/**
 * Extracts value for specified key from raw Cookie header string
 *
 * @example
 * parseCookieValue('NEXT_LOCALE=en; session=abc123', 'NEXT_LOCALE')
 * // → 'en'
 */
export function parseCookieValue(
  cookieHeader: string,
  key: string,
): string | undefined {
  const entry = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${key}=`));

  return entry?.slice(key.length + 1);
}
