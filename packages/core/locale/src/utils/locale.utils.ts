/**
 * locale.utils.ts - Locale utilities
 * @package @vxture/core-locale
 * @description
 *   Server-side locale resolution and content localization utilities
 *
 * @author AI-Generated
 * @date 2026-03-15
 */

import type { Locale } from "@vxture-platform/shared";
import { DEFAULT_LOCALE } from "@vxture-platform/shared";
import type { LocaleHeaders, LocaleRequest } from "../types";
import {
  isSupportedLocale,
  normalizeLocale,
  parseCookieValue,
} from "./locale-parser.utils";

// Fetch API Headers have a .get() method; Express headers are plain objects.
function getHeader(headers: LocaleHeaders, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    return (
      (headers as { get(n: string): string | null | undefined }).get(name) ??
      undefined
    );
  }
  const val = (headers as Record<string, string | string[] | undefined>)[
    name.toLowerCase()
  ];
  return Array.isArray(val) ? val[0] : val;
}

export function resolveLocale(request: LocaleRequest): Locale {
  // 1. Parsed cookie object (provided by Express/NestJS cookie-parser)
  if (request.cookies) {
    const raw = request.cookies["NEXT_LOCALE"];
    if (raw && isSupportedLocale(raw)) return raw as Locale;
  }

  // 2. Fallback to raw Cookie header string
  const cookieHeader = getHeader(request.headers, "cookie");
  if (cookieHeader) {
    const raw = parseCookieValue(cookieHeader, "NEXT_LOCALE");
    if (raw) {
      const normalized = normalizeLocale(raw);
      if (normalized) return normalized;
    }
  }

  // 3. Accept-Language header
  const acceptLanguage = getHeader(request.headers, "accept-language");
  if (acceptLanguage) {
    const candidates = acceptLanguage.split(",").flatMap((l) => {
      const part = l.split(";").at(0)?.trim();
      return part && part.length > 0 ? [part] : [];
    });

    for (const candidate of candidates) {
      const normalized = normalizeLocale(candidate);
      if (normalized) return normalized;
    }
  }

  // 4. Fallback
  return DEFAULT_LOCALE;
}

// ============================================================================
// Service-side Content Localization
// ============================================================================

/**
 * Server-side content localization lookup
 * @param content Multi-language content object
 * @param locale Target language
 * @returns Localized string
 *
 * Implementation logic:
 * 1. Return content[locale]
 * 2. If target language doesn't exist, fall back to content[DEFAULT_LOCALE]
 * 3. If DEFAULT_LOCALE also doesn't exist, return empty string
 *
 * Usage scenarios:
 * - BFF returning multi-language content fields, fetched by request language
 * - Service layer generating localized content like billing descriptions or notification messages
 */
export function localizeContent(
  content: Partial<Record<Locale, string>>,
  locale: Locale,
): string {
  // 1. Return content[locale]
  if (content[locale]) {
    return content[locale]!;
  }

  // 2. If target language doesn't exist, fall back to content[DEFAULT_LOCALE]
  if (content[DEFAULT_LOCALE]) {
    return content[DEFAULT_LOCALE]!;
  }

  // 3. If DEFAULT_LOCALE also doesn't exist, return empty string
  return "";
}
