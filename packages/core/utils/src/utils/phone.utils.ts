/**
 * phone.utils.ts - Phone number normalization (shared utility)
 * @package @vxture/core-utils
 * @layer Shared
 * @category utils
 *
 * @description
 *   Normalize phone numbers to the canonical E.164 form so the same physical
 *   number from different sources (OAuth providers, SMS code login, manual
 *   entry) resolves to one identity. E.164 embeds the country calling code,
 *   which keeps the platform ready for international (non-CN) numbers.
 *
 * @author AI-Generated
 * @date 2026-06-09
 */

import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

// ============================================================================
// Types
// ============================================================================

/** Structured, normalized phone parts with the country calling code surfaced. */
export interface NormalizedPhone {
  /** Canonical E.164 form, e.g. "+8618092907523"; the global identity anchor. */
  e164: string;
  /** Country calling code without the leading "+", e.g. "86" for China. */
  countryCallingCode: string;
  /** National (significant) number, e.g. "18092907523". */
  nationalNumber: string;
  /** ISO 3166-1 alpha-2 region, e.g. "CN"; undefined when undetectable. */
  country?: string;
}

/** Default region assumed for bare national numbers (e.g. SMS "18092907523"). */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "CN";

// ============================================================================
// Functions
// ============================================================================

/**
 * Parse and normalize a raw phone number to canonical E.164 parts.
 *
 * @param raw - number in any format ("+8618092907523", "008618...", "18092907523")
 * @param defaultCountry - region assumed for bare national numbers (default "CN")
 * @returns normalized parts, or null when the input is empty or not a valid number
 */
export function normalizePhoneNumber(
  raw: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): NormalizedPhone | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) {
    return null;
  }
  return {
    e164: parsed.number,
    countryCallingCode: parsed.countryCallingCode,
    nationalNumber: parsed.nationalNumber,
    ...(parsed.country ? { country: parsed.country } : {}),
  };
}

/**
 * Convenience helper returning only the canonical E.164 string.
 *
 * @param raw - number in any format
 * @param defaultCountry - region assumed for bare national numbers (default "CN")
 * @returns E.164 string, or null when invalid
 */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
): string | null {
  return normalizePhoneNumber(raw, defaultCountry)?.e164 ?? null;
}

/** Presentation parts only; never use these strings for identity comparisons. */
export interface PhoneDisplayParts {
  callingCode?: string | undefined;
  number: string;
}

/** Format known numbers for display and preserve masked or unknown input verbatim. */
export function formatPhoneForDisplay(
  raw: string | null | undefined,
): PhoneDisplayParts {
  const original = raw?.trim() ?? "";
  if (!original) return { number: "—" };
  // International access prefixes are not understood by every region parser.
  const input = original.replace(/^00(?=\d)/, "+");
  const parsed = parsePhoneNumberFromString(input, DEFAULT_PHONE_COUNTRY);
  if (!parsed?.isValid()) return { number: original };
  const national = String(parsed.nationalNumber);
  const number =
    parsed.countryCallingCode === "86" && /^1\d{10}$/.test(national)
      ? `${national.slice(0, 3)} ${national.slice(3, 7)} ${national.slice(7)}`
      : parsed
          .formatInternational()
          .slice(parsed.countryCallingCode.length + 2);
  return { callingCode: `+${parsed.countryCallingCode}`, number };
}
